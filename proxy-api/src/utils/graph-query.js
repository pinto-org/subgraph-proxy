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

  // Returns the minimum block that needs to have been indexed for this request to be serviceable.
  // Returns 0 for all introspection requests (always allow reply).
  // Returns `Number.MAX_SAFE_INTEGER` for requests that require the latest available data.
  static requiredIndexedBlock(originalQuery) {
    const introspectionRegex = /\s*(?:__schema|__type)\s*{/;
    if (introspectionRegex.test(originalQuery)) {
      return 0;
    }

    // Format the query such that its simply of the form entity(block)
    let replaced = originalQuery
      .replace(/^\s*{\s*\n?/, '') // remove the first `{`
      .replace(/\n?\s*}\s*$/, ''); // remove the last `}`

    // Simplify block selectors to an integer value. Insert large value if none was requested
    const blockRegex = /block\s*:\s*\{\s*number\s*:\s*(\d+)\s*\}/;
    replaced = replaced
      .replace(/\(([^()]*)\)/g, (match, inner) => {
        let blockMatch;
        if ((blockMatch = blockRegex.exec(inner)) !== null) {
          return `(${parseInt(blockMatch[1])})`;
        }
        return `(${Number.MAX_SAFE_INTEGER})`;
      })
      .replace(/(\w+)\s*{/, `$1(${Number.MAX_SAFE_INTEGER}) {`);

    // Remove everything between all remaining {}
    while (/{/.test(replaced)) {
      replaced = replaced.replace(/{[^{}]*}/g, '');
    }

    // Assess all numeric values inside ()
    const blocks = [...replaced.matchAll(/\(\s*(\d+)\s*\)/g)].map((match) => parseInt(match[1]));
    return Math.max(...blocks);
  }

  // Returns true if this query uses the time travel feature (i.e. explicit block)
  static usesTimeTravel(originalQuery) {
    // TODO
  }

  static _includesMeta(originalQuery) {
    return /_meta\s*\{/.test(originalQuery);
  }

  static _includesVersion(originalQuery) {
    return /version\s*\(\s*id\s*:\s*"subgraph"\s*\)\s*\{/.test(originalQuery);
  }
}

module.exports = GraphqlQueryUtil;
