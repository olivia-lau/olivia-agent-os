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
  if (chosen) $('repoFolder').value = chosen;
});
$('setup').addEventListener('submit', async event => {
  event.preventDefault();
  $('start').disabled = true;
  $('error').textContent = '';
  const result = await window.agentSetup.save({ displayName: $('name').value, backendType: $('backend').value, vaultPath: $('vault').value, repoUrl: $('repoUrl').value, repoFolder: $('repoFolder').value });
  if (!result.ok) { $('error').textContent = result.error; $('start').disabled = false; }
});
