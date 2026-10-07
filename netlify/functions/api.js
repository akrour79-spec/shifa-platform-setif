const serverless = require('serverless-http');
const { app } = require('../../server/index');

const expressHandler = serverless(app);

// نفاد: عند نشرها من Netlify, event.path يمكن أن يكون /.netlify/functions/api/...
// وال express يرى مسارات تبدأ بـ /api. نُرمّ العسكرية نعتبره /api بقدر ما.
module.exports.handler = function (event, context) {
  let p = event.path || '';
  const fnName = '/.netlify/functions/api';
  if (p.startsWith(fnName)) {
    p = p.slice(fnName.length);
    if (!p || p === '') p = '';
    if (!p.startsWith('/api')) p = '/api' + p;
    event.path = p;
  }
  if (event.rawPath && event.rawPath.startsWith(fnName)) {
    event.rawPath = '/api' + event.rawPath.slice(fnName.length);
  }
  return expressHandler(event, context);
};
