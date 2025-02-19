const _ = require('lodash');
const stringSimilarity = require('string-similarity');
const {
    imageHash
} = require('image-hash');
const dependencies = {
    imageHash
};
const log = require('../logger/log');

const logger = log.create({
    isPretty: true
});

function HashImage(imgUrl, cb) {
    logger.info(`hash-image::HashImage:: Hashing Image ${imgUrl}`);
    dependencies.imageHash(imgUrl, 16, true, (error, data) => {
        if (error) {
            return cb(error);
        }
        return cb(null, data);
    });
}

function CompareHash(hashOne, hashTwo) {
    logger.info(`hash-image::CompareHash:: Comparing Hashes ${hashOne} ${hashTwo}`);
    let HashLength = hashOne.length;
    let twoBitMatches = 0;
    let fourBitMatches = 0;
    hashOne.split('').forEach((c, index) => {
        if (index % 2 === 0) {
            let hashOneDoubleStr = hashOne.slice(index - 2, index);
            let hashTwoDoubleStr = hashTwo.slice(index - 2, index);
            twoBitMatches += hashOneDoubleStr === hashTwoDoubleStr ? 1 : 0;
        }
        if (index % 4 === 0) {
            let hashOneQuadStr = hashOne.slice(index - 4, index);
            let hashTwoQuadStr = hashTwo.slice(index - 4, index);
            fourBitMatches += hashOneQuadStr === hashTwoQuadStr ? 1 : 0;
        }
    });
    let comparisonResults = {
        twoBitMatches: _.round(twoBitMatches / (HashLength / 2), 2),
        fourBitMatches: _.round(fourBitMatches / (HashLength / 4), 2),
        stringCompare: _.round(stringSimilarity.compareTwoStrings(hashOne, hashTwo), 2)
    };
    logger.info("hash-image::CompareHash:: Hash Comparison Results", comparisonResults);
    return comparisonResults;
}

module.exports = {
    CompareHash,
    HashImage,
    dependencies
};