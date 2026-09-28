const $ = id => document.getElementById(id);
$('backend').addEventListener('change', () => {
  $('localFields').hidden = $('backend').value !== 'local';
  $('githubFields').hidden = $('backend').value !== 'github';
});
$('choose').addEventListener('click', async () => {
  const chosen = await window.agentSetup.chooseVault();
  if (chosen) $('vault').value = chosen;
});
$('chooseRepo').addEventListener('click', async () => {
  const chosen = await window.agentSetup.chooseVault();
  if (chosen) { $('repoFolder').value = chosen; $('githubVerification').textContent = 'Not verified yet.'; }
});
$('repoUrl').addEventListener('input', () => { $('githubVerification').textContent = 'Not verified yet.'; });
$('verifyGithub').addEventListener('click', async () => {
  $('verifyGithub').disabled = true;
  $('error').textContent = '';
  $('githubVerification').textContent = 'Checking GitHub access…';
  try {
    const result = await window.agentSetup.verifyGithub({ repoUrl: $('repoUrl').value, repoFolder: $('repoFolder').value });
    if (!result.ok) {
      $('githubVerification').textContent = 'Verification failed.';
      $('error').textContent = result.error;
    } else {
      $('githubVerification').textContent = `Verified access to ${result.repoId} · ${result.branch}. Vault folder: ${result.repoRoot}`;
    }
  } catch (error) {
    $('githubVerification').textContent = 'Verification failed.';
    $('error').textContent = error.message;
  } finally { $('verifyGithub').disabled = false; }
});
$('setup').addEventListener('submit', async event => {
  event.preventDefault();
  $('start').disabled = true;
  $('error').textContent = '';
  const result = await window.agentSetup.save({ displayName: $('name').value, backendType: $('backend').value, vaultPath: $('vault').value, repoUrl: $('repoUrl').value, repoFolder: $('repoFolder').value });
  if (!result.ok) { $('error').textContent = result.error; $('start').disabled = false; }
});
