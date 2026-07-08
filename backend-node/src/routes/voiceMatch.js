// backend-node/src/routes/voiceMatch.js
const response = require('../response');
const voiceMatchService = require('../services/voiceMatchService');

function routes(db, log) {
  return {
    recommendForDrama: async (req, res) => {
      try {
        const onlyUnassigned = req.query.only_unassigned === '1' || req.body?.only_unassigned === true;
        const results = await voiceMatchService.recommendVoicesForDrama(db, log, req.params.dramaId, { onlyUnassigned });
        response.success(res, { items: results });
      } catch (err) {
        log.error('voice-recommend drama', { error: err.message });
        response.badRequest(res, err.message);
      }
    },
    regenerateForCharacter: async (req, res) => {
      try {
        const result = await voiceMatchService.regenerateForCharacter(db, log, req.params.id);
        response.success(res, result);
      } catch (err) {
        log.error('voice-recommend character', { error: err.message });
        response.badRequest(res, err.message);
      }
    },
  };
}

module.exports = routes;
