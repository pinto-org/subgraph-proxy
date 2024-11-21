class GraphqlQueryUtil {
  static METADATA_QUERY = `
      _meta {
        block {
          number
        }
        deployment
      }
      version(id: "subgraph") {
        subgraphName
        versionNumber
        chain
      }`;

  static addMetadataToQuery(graphqlQuery) {
    return graphqlQuery.replace('{', `{\n${this.METADATA_QUERY}`);
  }

  /**
   * Removes `_meta` and `version` properties from the result if they were not explicitly requested.
   * @param {*} jsonResult
   * @param {*} originalQuery
   */
  static removeUnrequestedMetadataFromResult(jsonResult, originalQuery) {
    const result = JSON.parse(JSON.stringify(jsonResult));
    if (!this._includesMeta(originalQuery)) {
      delete result._meta;
    }
    if (!this._includesVersion(originalQuery)) {
      delete result.version;
    }
    return result;
  }

  // Returns the maximum of the explicitly requested blocks, if any. Returns undefined if none exist.
  static maxRequestedBlock(originalQuery) {
    const regex = /block\s*:\s*\{\s*number\s*:\s*(\d+)\s*\}/g;
    let match;
    let result = null;
    while ((match = regex.exec(originalQuery)) !== null) {
      result = Math.max(result, parseInt(match[1]));
    }
    return result;
  }

  static _includesMeta(originalQuery) {
    return /_meta\s*\{/.test(originalQuery);
  }

  static _includesVersion(originalQuery) {
    return /version\s*\(\s*id\s*:\s*"subgraph"\s*\)\s*\{/.test(originalQuery);
  }
}

module.exports = GraphqlQueryUtil;
