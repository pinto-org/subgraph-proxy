const SemVerUtil = require('../src/utils/semver');
const { gql } = require('graphql-request');
const GraphqlQueryUtil = require('../src/utils/graph-query');
const SubgraphProxyService = require('../src/services/subgraph-proxy-service');

const beanResponse = require('./mock-responses/bean.json');
const responseBlock = beanResponse._meta.block.number;

describe('Utils', () => {
  test('semver comparison', () => {
    expect(SemVerUtil.compareVersions('2.4.1', '2.3.1')).toEqual(1);
    expect(SemVerUtil.compareVersions('2.4.1', '2.3.2')).toEqual(1);
    expect(SemVerUtil.compareVersions('2.3.1', '2.3.2')).toEqual(-1);
    expect(SemVerUtil.compareVersions('2.3.2', '2.3.2.1')).toEqual(-1);
    expect(SemVerUtil.compareVersions('2.3.2', '2.3.2.0')).toEqual(0);
    expect(SemVerUtil.compareVersions('2.3.2', '2.3.2-label')).toEqual(0);
  });

  describe('Query manipulation tests', () => {
    test('Add and removes extra metadata from request/response', async () => {
      const spy = jest
        .spyOn(SubgraphProxyService, '_getQueryResult')
        .mockResolvedValueOnce({ data: beanResponse, endpointIndex: 0 });
      const query = gql`
        {
          beanCrosses(first: 5) {
            id
          }
        }
      `;
      const result = await SubgraphProxyService.handleProxyRequest('bean', query);

      expect(spy).toHaveBeenCalledWith(
        'bean',
        GraphqlQueryUtil.addMetadataToQuery(query),
        undefined,
        GraphqlQueryUtil.requiredIndexedBlock(query)
      );
      expect(result.meta.deployment).toEqual('QmXXZrhjqb4ygSWVgkPYBWJ7AzY4nKEUqiN5jnDopWBSCD');
      expect(result.body.beanCrosses.length).toEqual(5);
      expect(result.body._meta).toBeUndefined();
      expect(result.body.version).toBeUndefined();
    });

    test('Does not remove explicitly requested metadata', async () => {
      const spy = jest
        .spyOn(SubgraphProxyService, '_getQueryResult')
        .mockResolvedValueOnce({ data: beanResponse, endpointIndex: 0 });
      const query = gql`
        {
          _meta {
            block {
              number
            }
          }
          beanCrosses(first: 5) {
            id
          }
        }
      `;
      const result = await SubgraphProxyService.handleProxyRequest('bean', query);

      expect(spy).toHaveBeenCalledWith(
        'bean',
        GraphqlQueryUtil.addMetadataToQuery(query),
        undefined,
        GraphqlQueryUtil.requiredIndexedBlock(query)
      );
      expect(result.meta.deployment).toEqual('QmXXZrhjqb4ygSWVgkPYBWJ7AzY4nKEUqiN5jnDopWBSCD');
      expect(result.body.beanCrosses.length).toEqual(5);
      expect(result.body._meta.block.number).toEqual(responseBlock);
      expect(result.body.version).toBeUndefined();
    });

    test('Check for includes meta/version', () => {
      expect(GraphqlQueryUtil._includesMeta('_meta {')).toEqual(true);
      expect(GraphqlQueryUtil._includesMeta('_meta{')).toEqual(true);
      expect(GraphqlQueryUtil._includesMeta('_meta\n\n\n\n{')).toEqual(true);
      expect(GraphqlQueryUtil._includesVersion('version(id: "subgraph") {')).toEqual(true);
      expect(GraphqlQueryUtil._includesVersion('a  version\n(   id: \n\n"subgraph"){')).toEqual(true);
    });

    describe('Identifies required indexing progress', () => {
      test('Identifies introspection queries', () => {
        expect(GraphqlQueryUtil.requiredIndexedBlock(`{__schema{...}}`)).toEqual(0);
        expect(
          GraphqlQueryUtil.requiredIndexedBlock(`{
            __type
            {...}
          }`)
        ).toEqual(0);
        expect(GraphqlQueryUtil.requiredIndexedBlock(`{beanstalks{id}}`)).toEqual(Number.MAX_SAFE_INTEGER);
        expect(GraphqlQueryUtil.requiredIndexedBlock(`{beanstalks{id}} {__schema{...}}`)).toEqual(0);
      });

      test('Identifies max requested block in query', () => {
        expect(
          GraphqlQueryUtil.requiredIndexedBlock(`
          {
            latest {
              id
            }
          }
          `)
        ).toBe(Number.MAX_SAFE_INTEGER);

        expect(
          GraphqlQueryUtil.requiredIndexedBlock(`
          {
            well(
              id: "0x3e1133aC082716DDC3114bbEFEeD8B1731eA9cb1"
              block: {number: 24622961}
            ) {
              totalLiquidityUSD
            }
            version(id: "subgraph", block: {number: 123}) {
              versionNumber
            }
          }
          `)
        ).toBe(24622961);
      });

      test('Always allows _meta entity', () => {
        expect(
          GraphqlQueryUtil.requiredIndexedBlock(`
          {
            _meta {
              block {
                number
              }
            }
          }
          `)
        ).toBe(0);

        expect(
          GraphqlQueryUtil.requiredIndexedBlock(`
          {
            _meta {
              block {
                number
              }
            }
            top(block: {number: 123}) {
              id
              nested(where: test) {
                id
              }
            }
          }
          `)
        ).toBe(123);
      });

      test('Works with nested entity access', () => {
        expect(
          GraphqlQueryUtil.requiredIndexedBlock(`
          {
            top(block: {number: 123}) {
              id
              nested(where: test) {
                id
              }
            }
          }
          `)
        ).toBe(123);

        expect(
          GraphqlQueryUtil.requiredIndexedBlock(`
          {
            top(block: {number: 123}) {
              id
              nested(where: test) {
                id
              }
            }
            latest(id: 10) {
              id
            }
          }
          `)
        ).toBe(Number.MAX_SAFE_INTEGER);
      });

      test('Works with outer query name', () => {
        expect(
          GraphqlQueryUtil.requiredIndexedBlock(`query get_last_bean_crosses {
          beanCrosses(first: 1, orderBy: timestamp, orderDirection: desc) {
            timestamp
            above
            id
          }
        }`)
        ).toBe(Number.MAX_SAFE_INTEGER);
      });
    });
  });

  test('Identifies query features', () => {
    const features1 = GraphqlQueryUtil.queryFeaturesString(`
        {
          well(
            id: "0x3e1133aC082716DDC3114bbEFEeD8B1731eA9cb1"
            block: {number: 24622961}
          )
        }`);
    expect(['blk'].every((str) => features1.includes(str))).toBeTruthy();

    const features2 = GraphqlQueryUtil.queryFeaturesString(`
        {
          wells(
            where: {field: value}
            orderBy: field
            orderDirection: asc
          )
        }`);
    expect(['whr', 'srt'].every((str) => features2.includes(str))).toBeTruthy();

    const features3 = GraphqlQueryUtil.queryFeaturesString(`
      {
        wells(
          skip: 50
          block: {number: 24622961}
        )
      }`);
    expect(['blk', 'skp'].every((str) => features3.includes(str))).toBeTruthy();

    const noFeatures = GraphqlQueryUtil.queryFeaturesString(`
      {
        wells() { id }
      }`);
    expect(['whr', 'blk', 'srt', 'skp'].every((str) => !noFeatures.includes(str))).toBeTruthy();
  });
});
