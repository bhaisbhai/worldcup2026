const fs = require('fs');
const path = require('path');

module.exports = function (req, res) {
  try {
    const csv = fs.readFileSync(path.join(__dirname, '../data/days_ai.csv'), 'utf8');
    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.send(csv);
  } catch (e) {
    res.status(404).send('');
  }
};
