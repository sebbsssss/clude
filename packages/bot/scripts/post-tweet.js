#!/usr/bin/env node
require('dotenv').config();
const { postTweet } = require('../dist/core/x-client');

const text = process.argv.slice(2).join(' ');
if (!text) {
  console.error('Usage: node scripts/post-tweet.js "your tweet text"');
  process.exit(1);
}

console.log(`Posting tweet (${text.length} chars):\n${text}\n`);

(async () => {
  try {
    const tweetId = await postTweet(text);
    console.log(`Tweet posted! ID: ${tweetId}`);
    console.log(`https://x.com/i/status/${tweetId}`);
  } catch (err) {
    console.error('Failed to post tweet:', err);
    process.exit(1);
  }
})();
