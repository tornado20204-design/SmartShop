const bcrypt = require('bcryptjs');

async function test() {
  const p = await bcrypt.compare("Tornado@24", "$2b$10$LLLPnA18QNbBclmF0ya7qefcfkrvRelFbKY.LMF72CKslOB2fi/Fq");
  console.log("Async result:", p);
}
test();
