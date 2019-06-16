const _ = require('lodash');
const {
    textExtraction
} = require('../image-analysis/index');
const {
    resize
} = require('../image-processing/index');
const {
    MatchType,
    MatchName
} = require('../fuzzy-matching/index');
const {
    promisify,
} = require('util');
const {
    WriteToFile,
    CreateDirectory,
    CleanUpFiles
} = require('../file-io');
const {
    ProcessResults
} = require('../export-results/index');
const {
    Base64
} = require('../image-hashing/index');
const NeedsAttention = require('../models/needs-attention');
const logger = require('../logger/log');

const dependencies = {
    MatchName: MatchName.create()
}

const Scan = promisify(textExtraction.ScanImage);
const CleanFilesUp = promisify(CleanUpFiles);

function SingleProcessor(params) {
    _.bindAll(this, Object.keys(SingleProcessor.prototype));
    this.filePath = params.filePath;
    this.queryingEnabled = params.queryingEnabled;
    this.imagePaths = {};
    this.extractedText = {};
    this.matches = {};
    this.logger = logger.create({
        isPretty: params.isPretty
    });
}

SingleProcessor.prototype.execute = function (callback) {
    this._processCard(this.filePath, (err) => {
        if (err) {
            return callback(err);
        }
        return callback(null);
    });
}

SingleProcessor.prototype._processCard = function (path, callback) {
    CreateDirectory().then((directory) => {
        this.logger.info(`Created Directory: ${directory}`);
        this.directory = directory;
        return this._processImageFiles(path);
    }).then((paths) => {
        if (!paths) {
            throw new Error('No Image paths to process');
        }
        this.logger.info(`Imaged Pre-Processed: ${paths}`);
        return this._processFuzzyMatches();
    }).then(() => {
        this.logger.info(`Fuzzy Matches Processed: ${JSON.stringify(this.matches,null,4)}`);
        return this._processResults();
    }).then(() => {
        return this._CleanUpFiles();
    }).then(() => {
        this.logger.info(`Results Processed: Finished`);
        textExtraction.ShutDown();
        return callback(null);
    }).catch((err) => {
        this.logger.error(err);
        textExtraction.ShutDown();
        return callback(err);
    });
}

SingleProcessor.prototype.generateOutput = function (callback) {
    this._processOutputFile().then((filePath) => {
        return callback(null, filePath);
    }).catch((err) => {
        return callback(err);
    });
}

SingleProcessor.prototype._processImageFiles = async function (path) {
    await this._processArtImage(path);
    await this._processFlavorImage(path);
    await this._processNameImage(path);
    await this._processTypeImage(path);
    return this.imagePaths;
}

SingleProcessor.prototype._processFuzzyMatches = async function () {
    this.matches.nameMatches = await dependencies.MatchName.Match(this.extractedText.nameImage.cleanText);
    this.matches.typeMatches = MatchType(this.extractedText.typeImage.cleanText);
}

SingleProcessor.prototype._processNameImage = async function (path) {
    try {
        let imgPath = await resize.GetImageSnippetTmpFile(path, this.directory, 'name');
        this.imagePaths.nameImage = imgPath;
        this.extractedText.nameImage = await Scan(imgPath);
    } catch (err) {
        this.logger.error(err);
    }
}

SingleProcessor.prototype._processTypeImage = async function (path) {
    try {
        let imgPath = await resize.GetImageSnippetTmpFile(path, this.directory, 'type');
        this.imagePaths.typeImage = imgPath;
        this.extractedText.typeImage = await Scan(imgPath);
    } catch (err) {
        this.logger.error(err);
    }
}

SingleProcessor.prototype._processArtImage = async function (path) {
    try {
        let imgPath = await resize.GetImageSnippetTmpFile(path, this.directory, 'art');
        this.imagePaths.artImage = imgPath;
        return imgPath;
    } catch (err) {
        this.logger.error(err);
    }
}

SingleProcessor.prototype._processFlavorImage = async function (path) {
    try {
        let imgPath = await resize.GetImageSnippetTmpFile(path, this.directory, 'flavor');
        this.imagePaths.flavorImage = imgPath;
        return imgPath;
    } catch (err) {
        this.logger.error(err);
    }
}

SingleProcessor.prototype._processResults = async function () {
    if (!_.isEmpty(this.matches)) {
        //TODO
        let [namePercent, nameMatch] = this.matches.nameMatches[0];
        // let [typePercent, typeMatch] = this.matches.typeMatches[0];
        let resultsProcessor = ProcessResults.create({
            name: nameMatch,
            filePath: this.filePath,
            queryingEnabled: this.queryingEnabled,
            logger: this.logger
        });
        let results = await resultsProcessor.execute(this.filePath);
        if (results.error) {
            return results.error;
        }
        if (results.sets) {
            this.logger.warn('No Match Found Storing in Needs Atn');
            return await this._processNeedsAtn(results.sets);
        }
    }
    return [];
}

SingleProcessor.prototype._processOutputFile = async function () {
    let [namePercent, nameMatch] = this.matches.nameMatches[0];
    let [typePercent, typeMatch] = this.matches.typeMatches[0];
    let obj = {
        "path": this.filePath,
        "created": new Date().toDateString(),
        "name-percentage": namePercent,
        "name-string": nameMatch,
        "type-percentage": typePercent,
        "type-string": typeMatch
    }
    return await WriteToFile(obj);
}

SingleProcessor.prototype._processNeedsAtn = async function (sets) {
    this.logger.info(`Processing Needs Atn: ${sets}`);
    try {
        let base64Images = await this._getBase64Images();
        let nameMatch = this.matches.nameMatches[0] || [];
        let name = nameMatch[1] || '';
        let model = NeedsAttention.create({});
        let isValid = model.initiate({
            cardName: name,
            extractedText: this.extractedText.nameImage.cleanText,
            dirtyExtractedText: this.extractedText.nameImage.dirtyText,
            nameImage: base64Images.nameImage || 'VGhpcyBpcyBhIGZha2Ugc3RyaW5nIQ==', //Filler Base64 till error is fixed
            typeImage: base64Images.typeImage || 'VGhpcyBpcyBhIGZha2Ugc3RyaW5nIQ==',
            artImage: base64Images.artImage || 'VGhpcyBpcyBhIGZha2Ugc3RyaW5nIQ==',
            flavorImage: base64Images.flavorImage || 'VGhpcyBpcyBhIGZha2Ugc3RyaW5nIQ==',
            possibleSets: sets.join(',')
        });
        if (isValid) {
            if (this.queryingEnabled) {
                model.Insert();
            }
        } else {
            this.logger.error('Error processing Needs Attention');
        }
    } catch (error) {
        this.logger.error('Error Processing Needs Atn Record');
        this.logger.error(error);
    }
};

SingleProcessor.prototype._getBase64Images = async function () {
    return await Base64.StringfyImagesNDAtn(this.imagePaths);
}

SingleProcessor.prototype._CleanUpFiles = async function() {
    try {
        this.logger.info(`_CleanUpFiles:: Beginning Clean Up ${this.directory}`);
        await CleanFilesUp(this.directory);
        this.logger.info(`_CleanUpFiles:: Finished Clean Up ${this.directory}`);
        return this.directory;
    } catch(err) {
        this.logger.error(err);
        return '';
    }
};

module.exports = {
    create: function (params) {
        return new SingleProcessor(params);
    },
    dependencies
}