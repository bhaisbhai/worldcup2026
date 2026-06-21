const recaps = require('../data/recaps.json');

module.exports = function (req, res) {
  res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');
  res.json(recaps);
};
