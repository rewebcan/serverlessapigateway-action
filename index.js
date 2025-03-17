const core = require('@actions/core');
const github = require('@actions/github');
const exec = require('@actions/exec');
const fs = require('fs');
const fetch = require('node-fetch');
const { promisify } = require('util');
const writeFile = promisify(fs.writeFile);

async function downloadFile(url, path) {
  const res = await fetch(url, {
    headers: {
      'Authorization': `token ${process.env.GITHUB_TOKEN}`
    }
  });
  const fileStream = fs.createWriteStream(path);
  await new Promise((resolve, reject) => {
    res.body.pipe(fileStream);
    res.body.on("error", reject);
    fileStream.on("finish", resolve);
  });
}

async function run() {
  try {
    const configPath = core.getInput('configJson', { required: true });
    const wranglerPath = core.getInput('wranglerToml', { required: true });
    const versionTag = core.getInput('versionTag', { required: true });
    const repoOwner = 'irensaltali';
    const repoName = 'serverlessapigateway';
    await exec.exec('npm install wrangler --save-dev');
    await exec.exec('npx wrangler --version');

    // Initialize GitHub client
    console.log('Initializing GitHub client');
    const octokit = github.getOctokit(process.env.GITHUB_TOKEN);

    // Fetch the release by tag
    console.log(`Fetching release ${versionTag}`);
    const { data: release } = await octokit.rest.repos.getReleaseByTag({
      owner: repoOwner,
      repo: repoName,
      tag: versionTag
    });

    // Assume there's only one asset and it's the one we want
    const asset = release.assets[0];
    if (!asset) {
      throw new Error(`No assets found for release ${versionTag}`);
    }

    //Unzip the release and write
    console.log(`Unzipping release ${versionTag}`);
    const zipUrl = release.zipball_url;
    const zipPath = `./temp-${versionTag}.zip`;
    await downloadFile(zipUrl, zipPath);
    await exec.exec(`unzip ${zipPath}`);
    fs.unlinkSync(zipPath);
    const zipDir = fs.readdirSync('.').find(f => f.startsWith('irensaltali-serverlessapigateway-'));
    if (!zipDir) {
      throw new Error(`No zip directory found for release ${versionTag}`);
    }

    // Move 'workers' directory to current directory
    console.log(`Moving workers directory to current directory`);
    fs.rename(`${zipDir}`, './worker', (err) => {
      if (err) {
        return console.error(err);
      }
    });

    // Prepare wrangler and config.json files
    console.log('Preparing wrangler and config.json files');
    await writeFile('./worker/wrangler.toml', fs.readFileSync(wranglerPath));
    await writeFile('./worker/src/api-config.json', fs.readFileSync(configPath));

    console.log('Worker ready for deployment');
  } catch (error) {
    core.setFailed(`Action failed: ${error}`);
  }
}

run();
