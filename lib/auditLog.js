const logger = require('./logger');

/**
 * Security / ops audit line — never log secrets or full message bodies.
 */
function audit(action, fields = {}) {
  logger.info('audit', { action, ...fields });
}

module.exports = { audit };
