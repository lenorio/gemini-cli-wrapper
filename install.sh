#!/bin/bash
echo "========================================================"
echo "Installing Gemini Local CLI v2.0.0..."
echo "========================================================"

npm install
npx playwright install chromium
npm link

echo "========================================================"
echo "Installation complete! Run 'gemini-cli' to start."
echo "========================================================"
