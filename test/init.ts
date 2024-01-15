import path from "node:path";

process.env.TS_NODE_PROJECT = path.resolve('tsconfig.json')
process.env.NODE_ENV = 'development'
process.env.NODE_OPTIONS = '--loader ts-node/esm'
