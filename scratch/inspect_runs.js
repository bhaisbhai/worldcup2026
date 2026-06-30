import fs from 'fs';
const data = JSON.parse(fs.readFileSync('scratch/github_runs.json', 'utf8'));

data.workflow_runs.slice(0, 10).forEach(r => {
  console.log(`- Name: "${r.name}", Event: "${r.event}", Status: "${r.status}", Conclusion: "${r.conclusion}", SHA: "${r.head_sha.substring(0, 7)}", URL: ${r.html_url}`);
});
