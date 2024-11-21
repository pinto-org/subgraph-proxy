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
      const spy = jest.spyOn(SubgraphProxyService, '_getQueryResult').mockResolvedValueOnce(beanResponse);
      const query = gql`
        {
          beanCrosses(first: 5) {
            id
          }
        }
      `;
      const result = await SubgraphProxyService.handleProxyRequest('bean', query);

      expect(spy).toHaveBeenCalledWith('bean', GraphqlQueryUtil.addMetadataToQuery(query), undefined);
      expect(result.meta.deployment).toEqual('QmXXZrhjqb4ygSWVgkPYBWJ7AzY4nKEUqiN5jnDopWBSCD');
      expect(result.body.beanCrosses.length).toEqual(5);
      expect(result.body._meta).toBeUndefined();
      expect(result.body.version).toBeUndefined();
    });

    test('Does not remove explicitly requested metadata', async () => {
      const spy = jest.spyOn(SubgraphProxyService, '_getQueryResult').mockResolvedValueOnce(beanResponse);
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

      expect(spy).toHaveBeenCalledWith('bean', GraphqlQueryUtil.addMetadataToQuery(query), undefined);
      expect(result.meta.deployment).toEqual('QmXXZrhjqb4ygSWVgkPYBWJ7AzY4nKEUqiN5jnDopWBSCD');
      expect(result.body.beanCrosses.length).toEqual(5);
      expect(result.body._meta.block.number).toEqual(responseBlock);
      expect(result.body.version).toBeUndefined();
    });

    test('Identifies maximal explicitly requested block', () => {
      expect(
        GraphqlQueryUtil.maxRequestedBlock(gql`
          {
            fertilizerBalances {
              amount
            }
          }
        `)
      ).toEqual(null);
      expect(
        GraphqlQueryUtil.maxRequestedBlock(gql`
          {
            fertilizerBalances {
              amount
            }
            fields(block: { number: 55 }) {
              id
            }
          }
        `)
      ).toEqual(55);
      expect(
        GraphqlQueryUtil.maxRequestedBlock(`
          {
            fertilizerBalances   (block: { number:\n12345 }) {
              amount
            }
            fields(block: {    number: 55 }) {
              id
            }
          }
        `)
      ).toEqual(12345);
    });

    test('Check for includes meta/version', () => {
      expect(GraphqlQueryUtil._includesMeta('_meta {')).toEqual(true);
      expect(GraphqlQueryUtil._includesMeta('_meta{')).toEqual(true);
      expect(GraphqlQueryUtil._includesMeta('_meta\n\n\n\n{')).toEqual(true);
      expect(GraphqlQueryUtil._includesVersion('version(id: "subgraph") {')).toEqual(true);
      expect(GraphqlQueryUtil._includesVersion('a  version\n(   id: \n\n"subgraph"){')).toEqual(true);
    });
  });
});
