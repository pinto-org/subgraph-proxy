require('dotenv').config();
import React from 'react';
import ReactDOM from 'react-dom';
import { GraphiQL } from 'graphiql';
import { createGraphiQLFetcher } from '@graphiql/toolkit';
import { explorerPlugin } from '@graphiql/plugin-explorer';

// The prefix is set according to nginx configuration but is relevant here as the location is used directly.
const LOCATION_PREFIX = '/' + process.env.REACT_APP_LOCATION_PREFIX;
const DEFAULT_LOCATION = LOCATION_PREFIX + '/' + process.env.REACT_APP_DEFAULT_SUBGRAPH;

import 'graphiql/graphiql.css';
import '@graphiql/plugin-explorer/dist/style.css';

// Allow endpoint change
const setEndpoint = (url) => {
  const fetcher = createGraphiQLFetcher({ url });
  const graphiql = React.createElement(GraphiQL, {
    fetcher,
    plugins: [explorer],
    defaultEditorToolsVisibility: true
  });

  console.log('Using endpoint', url);
  ReactDOM.render(graphiql, document.getElementById('graphiql'));
};

if (
  window.location.pathname === '/' ||
  window.location.pathname === '' ||
  window.location.pathname === LOCATION_PREFIX ||
  window.location.pathname === LOCATION_PREFIX + '/'
) {
  window.history.replaceState({}, '', DEFAULT_LOCATION);
}

const explorer = explorerPlugin();
setEndpoint(`https://${process.env.REACT_APP_DOMAIN}${window.location.pathname.replace(LOCATION_PREFIX, '')}`);
