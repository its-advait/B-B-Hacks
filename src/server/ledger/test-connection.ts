import { connectLedger, disconnectLedger } from './client.js'
try { console.log(JSON.stringify(await connectLedger(), null, 2)) }
catch (error) { console.error(error instanceof Error ? error.message : error); process.exitCode = 1 }
finally { await disconnectLedger() }
