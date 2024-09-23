const express = require('express');
const { createDirectus, rest, authentication, readItems, updateItem, createItem } = require("@directus/sdk");
const axios = require("axios");
const dotenv = require("dotenv");

dotenv.config();

if (!process.env.DIRECTUS_URL) throw new Error('DIRECTUS_URL is not defined');
const directus = createDirectus(process.env.DIRECTUS_URL)
  .with(rest())
  .with(authentication());

const router = express.Router();

router.get('/', async (req, res) => {
  console.info('TikTok media update process started info');
  res.status(202).json({ msg: "TikTok user update process started." });
  await core().catch(error => {
    console.error("Error in core function:", error);
  });
  console.log('TikTok user update process ended log');
});

async function core() {
  console.log('core: start');

  let userCount = 0;
  let updateCount = 0;

  const email = process.env.DIRECTUS_ADMIN_EMAIL;
  const password = process.env.DIRECTUS_ADMIN_PASSWORD;
  if (!email || !password) {
    throw new Error('Directus admin credentials are not set in environment variables');
  }
  const token = await directus.login(email, password);
  console.log('core: token', token);

  try {
    const tiktokUsers = await directus.request(
      readItems('tiktok_users', {
        limit: -1,
      })
    );
    
    console.log('got the tiktok_users');
    for (const user of tiktokUsers) {
      userCount++;
      console.log('updateUser: checking if should update for', user.id, user.unique_id);
      const shouldUpdate = await checkIfShouldUpdate(user);
      if (shouldUpdate) {
        await updateUser(user);
        updateCount++;
      }
    }

    console.log('Total users, updates processed:', userCount, updateCount);
  } catch (error) {
    console.error("An error occurred while updating TikTok users:", error);
  }
}

async function checkIfShouldUpdate(user) {
  if (user.last_updated === null) return true;

  const now = new Date();
  const lastUpdated = new Date(user.last_updated);
  const interval = user.interval * 60 * 60 * 1000; // Convert hours to milliseconds
  
  const diff = now.getTime() - lastUpdated.getTime() > interval;
  console.log(`checkIfShouldUpdate: ${diff} ${now.getTime() - lastUpdated.getTime()} | now: ${now.toISOString()} | lastUpdated: ${lastUpdated.toISOString()} | interval: ${user.interval} hours` );
  return diff;
}

async function updateUser(user) {
  console.log('updateUser: fetching TikTok user data for', user.id, user.unique_id);
  const data = await fetchTikTokUser(user.unique_id);
  
  const firstData = data.users[user.unique_id];
  const stats = data.stats[user.unique_id];

  await saveTikTokUser(firstData, stats, user.id);
  await saveTikTokUserStatsHistory(stats, firstData.id, user.id);

  await updateLastUpdated(user.id);
  console.log('updateUser: saved TikTok user data + stats history + updated last_updated for user', user.id, user.unique_id);
}

async function fetchTikTokUser(
  username
) {
  const url = new URL(process.env.TIKTOK_PAPI_URL + "/user/by/username");
  url.searchParams.append("username", username);

  const response = await axios.get(url.toString(), {
    headers: {
      "x-access-key": process.env.TIKTOK_PAPI_KEY,
    },
  });
  return response.data;
}

async function saveTikTokUser(
  firstData,
  stats,
  userId
) {
  const finalData = {
    tiktok_id: firstData.id,
    nickname: firstData.nickname,
    signature: firstData.signature,
    avatar: firstData.avatarMedium,
    created: new Date(firstData.createTime * 1000).toISOString(),
    verified: firstData.verified,
    sec_uid: firstData.secUid,
    bio_link: firstData.bioLink?.link || null,
    private: firstData.privateAccount,
    followers: stats.followerCount,
    following: stats.followingCount,
    hearts: stats.heartCount,
    videos: stats.videoCount,
    friends: stats.friendCount
  }

  await directus.request(
    updateItem('tiktok_users', userId, finalData)
  );
}

async function saveTikTokUserStatsHistory(stats, tiktokId, userId) {
  const statsHistoryData = {
    tiktok_id: tiktokId,
    timestamp: new Date().toISOString(),
    followers: stats.followerCount,
    following: stats.followingCount,
    hearts: stats.heartCount,
    videos: stats.videoCount,
    friends: stats.friendCount,
    user: userId // This links to the tiktok_users collection
  };

  await directus.request(
    createItem('tiktok_user_stats_history', statsHistoryData)
  );

  console.log(`Saved stats history for user ${userId}`);
}

async function updateLastUpdated(userId) {
  const now = new Date().toISOString();
  console.log(`Updating last_updated for user ${userId} to: ${now}`);
  await directus.request(
    updateItem('tiktok_users', userId, {
      last_updated: new Date().toISOString()
    })
  );
}

module.exports = router;
