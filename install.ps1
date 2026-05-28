Write-Host "========================================================" -ForegroundColor Cyan
Write-Host "Installing Gemini Local CLI v2.0.0..." -ForegroundColor Cyan
Write-Host "========================================================" -ForegroundColor Cyan

npm install
npx playwright install chromium
npm link

Write-Host "========================================================" -ForegroundColor Green
Write-Host "Installation complete! Run 'gemini-cli' to start." -ForegroundColor Green
Write-Host "========================================================" -ForegroundColor Green
