const express = require("express");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcrypt");
const sqlite3 = require("sqlite3");
const { open } = require("sqlite");
const path = require("path");
const app = express();
app.use(express.json());

const dbPath = path.join(__dirname, "twitterClone.db");
let db = null;

const initializeDbAndServer = async () => {
  try {
    db = await open({
      filename: dbPath,
      driver: sqlite3.Database,
    });

    app.listen(3000, () => {
      console.log("Server Running at http://localhost:3000/");
    });
  } catch (e) {
    console.log(`DB Error: ${e.message}`);
    process.exit(1);
  }
};

initializeDbAndServer();

const convertTweetDbToResponse = (dbObject) => {
  return {
    tweetId: dbObject.tweet_id,
    tweet: dbObject.tweet,
    userId: dbObject.user_id,
    dateTime: dbObject.date_time,
  };
};

const getFollowingPeopleIdsOfUser = async (username) => {
  const getTheFollowingPeopleQuery = `
    SELECT following_user_id FROM follower INNER JOIN user ON user.user_id = follower.follower_user_id 
    WHERE user.username = '${username}';`;

  const followingPeople = await db.all(getTheFollowingPeopleQuery);
  const arrayOfIds = followingPeople.map(
    (eachUser) => eachUser.following_user_id
  );
  return arrayOfIds;
};

const authenticateToken = (request, response, next) => {
  let jwtToken;
  const authHeader = request.headers["authorization"];
  if (!authHeader) {
    response.status(401).send("Invalid JWT Token");
    return;
  } else {
    const jwtToken = authHeader.split(" ")[1];
    jwt.verify(jwtToken, "MY_SECRET_TOKEN", (error, payload) => {
      if (error) {
        response.status(401).send("Invalid JWT Token");
      } else {
        request.username = payload.username;
        request.userId = payload.userId;
        next();
      }
    });
  }
};

const tweetAccessVerification = async (request, response, next) => {
  const { userId } = request;
  const { tweetId } = request.params;
  const getTweetQuery = `SELECT * FROM tweet INNER JOIN follower ON tweet.user_id = follower.follower_user_id WHERE tweet.tweet_id = '${tweetId}' AND tweet.user_id = '${userId}';`;
  const tweet = await db.get(getTweetQuery);
  if (tweet === undefined) {
    response.status(401).send("Invalid Request");
  } else {
    next();
  }
};

//api-1

app.post("/register/", async (request, response) => {
  const { username, password } = request.body;
  const selectedUserQuery = `
    SELECT * FROM user WHERE username = '${username}';`;
  const existingUser = await db.get(selectedUserQuery);

  if (existingUser === undefined) {
    if (password.length < 6) {
      response.status(400).send("Password is too short");
    } else {
      const hashedPassword = await bcrypt.hash(password, 10);
      const createUserQuery = `
        INSERT INTO user (username, password) VALUES ('${username}', '${hashedPassword}');`;
      await db.run(createUserQuery);
      response.status(200).send("User created successfully");
    }
  } else {
    response.status(400).send("User already exists");
  }
});

//api-2

app.post("/login/", async (request, response) => {
  const { username, password } = request.body;
  const selectUser = `SELECT * FROM user WHERE username = '${username}';`;
  const user = await db.get(selectUser);

  if (user === undefined) {
    response.status(400).send("Invalid user");
  } else {
    const isPasswordMatched = await bcrypt.compare(password, user.password);
    if (isPasswordMatched) {
      const payload = {
        username: username,
        userId: user.user_id, // Add this line to get the userId from the user object
      };
      const jwtToken = jwt.sign(payload, "MY_SECRET_TOKEN");
      response.send({ jwtToken });
    } else {
      response.status(400).send("Invalid password");
    }
  }
});

//api-3

app.get("/user/tweets/feed/", authenticateToken, async (req, res) => {
  const { userId } = req;

  const followingPeopleIds = await getFollowingPeopleIdsOfUser(req.username);
  const feedQuery = `SELECT user.username, tweet.tweet, tweet.date_time as dateTime
                       FROM user
                       INNER JOIN tweet ON user.user_id = tweet.user_id
                       WHERE user.user_id IN (${followingPeopleIds})
                       ORDER BY tweet.date_time DESC
                       LIMIT 4;`;
  const tweets = await db.all(feedQuery);
  res.json(tweets);
});

// API 4 - User's Following List
app.get("/user/following/", authenticateToken, async (req, res) => {
  const { username, userId } = req;
  const followingQuery = `
    SELECT name
    FROM follower
    INNER JOIN user ON follower.following_user_id = user.user_id
    WHERE follower.follower_user_id = ?`;
  const following = await db.all(followingQuery, [userId]);
  res.send(following);
});

// API 5 - User's Followers List
app.get("/user/followers/", authenticateToken, async (req, res) => {
  const { username, userId } = req;
  const followersQuery = `
    SELECT DISTINCT name 
    FROM follower
    INNER JOIN user ON follower.follower_user_id = user.user_id
    WHERE follower.following_user_id = ?`;
  const followers = await db.all(followersQuery, [userId]);
  res.send(followers);
});

app.get(
  "/tweets/:tweetId/",
  authenticateToken,
  tweetAccessVerification,
  async (req, res) => {
    const { tweetId } = req.params;

    const tweetQuery = `
      SELECT tweet, 
      (SELECT COUNT(*) FROM "like" WHERE tweet_id = '${tweetId}') AS likes,
      (SELECT COUNT(*) FROM "reply" WHERE tweet_id = '${tweetId}') AS replies,
      date_time AS dateTime 
      FROM tweet 
      WHERE tweet_id = '${tweetId}';`;

    const tweetInfo = await db.get(tweetQuery);

    res.json(tweetInfo);
  }
);

// API 7 - List of Users Who Liked a Tweet
app.get(
  "/tweets/:tweetId/likes/",
  authenticateToken,
  tweetAccessVerification,
  async (req, res) => {
    const { tweetId } = req.params;

    const likesQuery = `
      SELECT user.username 
      FROM user 
      INNER JOIN like ON user.user_id = like.user_id
      WHERE like.tweet_id = '${tweetId}';`;

    const likedUsers = await db.all(likesQuery);
    res.json(likedUsers.map(eachItem));
  }
);

// API 8 - List of Replies to a Tweet
app.get(
  "/tweets/:tweetId/replies/",
  authenticateToken,
  tweetAccessVerification,
  async (req, res) => {
    const { tweetId } = req.params;

    const repliesQuery = `
      SELECT user.username, reply.reply, reply.date_time AS dateTime
      FROM "reply" 
      INNER JOIN user ON user.user_id = reply.user_id
      WHERE reply.tweet_id = '${tweetId}';`;

    const repliedUsers = await db.all(repliesQuery);

    const tweetQuery = `
      SELECT tweet, 
      (SELECT COUNT(*) FROM "like" WHERE tweet_id = '${tweetId}') AS likes,
      (SELECT COUNT(*) FROM "reply" WHERE tweet_id = '${tweetId}') AS replies,
      date_time AS dateTime 
      FROM tweet 
      WHERE tweet_id = '${tweetId}';`;

    const tweetInfo = await db.get(tweetQuery);

    res.json({ tweet: tweetInfo, replies: repliedUsers });
  }
);

// API 9 - List of User's Tweets
app.get("/user/tweets/", authenticateToken, async (req, res) => {
  const userId = req.userId; // Corrected this line
  const userTweetsQuery = `
    SELECT tweet,
    COUNT(DISTINCT like_id) as likes,
    COUNT(DISTINCT reply_id) as replies,
    date_time as dateTime FROM tweet LEFT JOIN reply ON tweet.tweet_id = reply.tweet_id
    LEFT JOIN like ON tweet.tweet_id = like.tweet_id
    WHERE tweet.user_id = ${userId}
    GROUP BY tweet.tweet_id;`;

  const userTweets = await db.all(userTweetsQuery);
  res.json(userTweets);
});

// API 10 - Create a Tweet
app.post("/user/tweets/", authenticateToken, async (req, res) => {
  const { userId } = req;
  const { tweet } = req.body;

  const dateTime = new Date().toISOString().slice(0, 19).replace("T", " ");
  const createTweetQuery = `
        INSERT INTO tweet(tweet, user_id, date_time)
        VALUES ('${tweet}', ${userId}, '${dateTime}');`;

  await db.run(createTweetQuery);
  res.send("Created a Tweet");
});

// API 11 - Delete a Tweet
app.delete("/tweets/:tweetId/", authenticateToken, async (req, res) => {
  const { tweetId } = req.params;
  const { userId } = req;

  const getTweetQuery = `SELECT * FROM tweet WHERE tweet_id = '${tweetId}' AND user_id = '${userId}';`;
  const tweet = await db.get(getTweetQuery);

  if (!tweet) {
    res.status(401).send("Invalid Request");
  } else {
    const deleteTweetQuery = `
            DELETE FROM tweet
            WHERE tweet_id = ? AND user_id = ?`;
    await db.run(deleteTweetQuery, [tweetId, userId]);
    res.send("Tweet Removed");
  }
});

module.exports = app;
