// Genera due link segreti casuali (da salvare SOLO come env var su Render).
const c = require('crypto');
console.log('NN_TOKEN_NICO=' + c.randomBytes(24).toString('base64url'));
console.log('NN_TOKEN_NICOLA=' + c.randomBytes(24).toString('base64url'));
