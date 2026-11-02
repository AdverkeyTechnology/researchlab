require('../lib/db').initialize().then(()=>console.log('Database schema is ready.')).catch(e=>{console.error(e.message);process.exitCode=1}).finally(()=>require('../lib/db').close());
