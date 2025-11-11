const express = require("express");
const cors = require("cors");
const { MongoClient, ObjectId, ServerApiVersion } = require("mongodb");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());


const uri =
    "mongodb+srv://b12a10:b12a10pass@cluster0.o1qvulf.mongodb.net/?appName=Cluster0";
  
    const client = new MongoClient(uri, {
      serverApi: {
        version: ServerApiVersion.v1,
        strict: true,
        deprecationErrors: true,
      },
    });

async function run() {
  try {
      await client.connect();
    const db = client.db(DB_NAME);
    const challengesCol = db.collection("challenges");
    const userChallengesCol = db.collection("userChallenges");
    const tipsCol = db.collection("tips");
    const eventsCol = db.collection("events");

    app.get("/", (req, res) => {
      res.send({ message: "EcoTrack API is running" });
    });

    app.get("/api/challenges", async (req, res) => {
      try {
        const {
          category,
          startDateFrom,
          startDateTo,
          minParticipants,
          maxParticipants,
          search,
          limit,
          page,
          sortBy,
        } = req.query;

        const filter = {};

        if (category) {
          const cats = category.split(",").map((c) => c.trim());
          filter.category = { $in: cats };
        }

        if (startDateFrom || startDateTo) {
          filter.startDate = {};
          if (startDateFrom) filter.startDate.$gte = new Date(startDateFrom);
          if (startDateTo) filter.startDate.$lte = new Date(startDateTo);
        }

        if (minParticipants || maxParticipants) {
          filter.participants = {};
          if (minParticipants) filter.participants.$gte = parseInt(minParticipants);
          if (maxParticipants) filter.participants.$lte = parseInt(maxParticipants);
        }

        if (search) {
          const regex = new RegExp(search, "i");
          filter.$or = [{ title: regex }, { description: regex }, { category: regex }];
        }

        const pageNum = parseInt(page) || 1;
        const perPage = parseInt(limit) || 20;
        const skip = (pageNum - 1) * perPage;

        let cursor = challengesCol.find(filter);
        if (sortBy === "participants") cursor = cursor.sort({ participants: -1 });
        else if (sortBy === "startDate") cursor = cursor.sort({ startDate: 1 });
        else cursor = cursor.sort({ createdAt: -1 });

        const total = await cursor.count();
        const data = await cursor.skip(skip).limit(perPage).toArray();

        res.send({ ok: true, total, page: pageNum, perPage, data });
      } catch (err) {
        res.status(500).send({ ok: false, message: "Server error fetching challenges" });
      }
    });

    app.get("/api/challenges/:id", async (req, res) => {
      try {
        const id = req.params.id;
        if (!ObjectId.isValid(id)) return res.status(400).send({ message: "Invalid ID" });
        const challenge = await challengesCol.findOne({ _id: new ObjectId(id) });
        if (!challenge) return res.status(404).send({ message: "Challenge not found" });
        res.send({ ok: true, data: challenge });
      } catch {
        res.status(500).send({ ok: false, message: "Server error" });
      }
    });

    app.post("/api/challenges", async (req, res) => {
      try {
        const body = req.body;
        const required = ["title", "category", "description", "duration", "impactMetric", "startDate", "endDate"];
        for (const key of required) {
          if (!body[key]) return res.status(400).send({ ok: false, message: `${key} is required` });
        }

        const newChallenge = {
          title: body.title,
          category: body.category,
          description: body.description,
          duration: parseInt(body.duration),
          target: body.target || "",
          participants: parseInt(body.participants) || 0,
          impactMetric: body.impactMetric,
          createdBy: body.createdBy || "admin@ecotrack.com",
          startDate: new Date(body.startDate),
          endDate: new Date(body.endDate),
          imageUrl: body.imageUrl || "",
          createdAt: new Date(),
          updatedAt: new Date(),
        };

        const result = await challengesCol.insertOne(newChallenge);
        res.send({ ok: true, insertedId: result.insertedId });
      } catch {
        res.status(500).send({ ok: false, message: "Could not create challenge" });
      }
    });

    app.patch("/api/challenges/:id", async (req, res) => {
      try {
        const id = req.params.id;
        if (!ObjectId.isValid(id)) return res.status(400).send({ message: "Invalid ID" });

        const updates = { ...req.body, updatedAt: new Date() };
        if (updates.startDate) updates.startDate = new Date(updates.startDate);
        if (updates.endDate) updates.endDate = new Date(updates.endDate);
        if (updates.duration) updates.duration = parseInt(updates.duration);
        if (updates.participants) updates.participants = parseInt(updates.participants);

        const result = await challengesCol.updateOne({ _id: new ObjectId(id) }, { $set: updates });
        if (result.matchedCount === 0) return res.status(404).send({ message: "Challenge not found" });
        res.send({ ok: true, modifiedCount: result.modifiedCount });
      } catch {
        res.status(500).send({ ok: false, message: "Could not update challenge" });
      }
    });

    app.delete("/api/challenges/:id", async (req, res) => {
      try {
        const id = req.params.id;
        if (!ObjectId.isValid(id)) return res.status(400).send({ message: "Invalid ID" });
        const result = await challengesCol.deleteOne({ _id: new ObjectId(id) });
        if (result.deletedCount === 0) return res.status(404).send({ message: "Challenge not found" });
        await userChallengesCol.deleteMany({ challengeId: id });
        res.send({ ok: true, deletedCount: result.deletedCount });
      } catch {
        res.status(500).send({ ok: false, message: "Could not delete challenge" });
      }
    });

    app.post("/api/challenges/join/:id", async (req, res) => {
      try {
        const challengeId = req.params.id;
        const { userId } = req.body;
        if (!userId) return res.status(400).send({ message: "userId is required in body" });
        if (!ObjectId.isValid(challengeId)) return res.status(400).send({ message: "Invalid challenge ID" });
        const exists = await userChallengesCol.findOne({ challengeId, userId });
        if (exists) return res.status(400).send({ message: "User already joined" });

        const newUserChallenge = {
          userId,
          challengeId,
          status: "Not Started",
          progress: 0,
          joinDate: new Date(),
          updatedAt: new Date(),
        };

        await userChallengesCol.insertOne(newUserChallenge);
        await challengesCol.updateOne({ _id: new ObjectId(challengeId) }, { $inc: { participants: 1 } });
        res.send({ ok: true, message: "Joined challenge" });
      } catch {
        res.status(500).send({ ok: false, message: "Could not join challenge" });
      }
    });

    app.get("/api/user-challenges", async (req, res) => {
      try {
        const { userId } = req.query;
        if (!userId) return res.status(400).send({ message: "userId query required" });
        const items = await userChallengesCol.find({ userId }).toArray();
        res.send({ ok: true, data: items });
      } catch {
        res.status(500).send({ ok: false, message: "Could not fetch user challenges" });
      }
    });

    app.patch("/api/user-challenges/:id", async (req, res) => {
      try {
        const id = req.params.id;
        if (!ObjectId.isValid(id)) return res.status(400).send({ message: "Invalid ID" });
        const updates = { ...req.body, updatedAt: new Date() };
        if (updates.progress) updates.progress = parseFloat(updates.progress);
        const result = await userChallengesCol.updateOne({ _id: new ObjectId(id) }, { $set: updates });
        if (result.matchedCount === 0) return res.status(404).send({ message: "User challenge not found" });
        res.send({ ok: true, modifiedCount: result.modifiedCount });
      } catch {
        res.status(500).send({ ok: false, message: "Could not update user challenge" });
      }
    });

    app.delete("/api/user-challenges/:id", async (req, res) => {
      try {
        const id = req.params.id;
        if (!ObjectId.isValid(id)) return res.status(400).send({ message: "Invalid ID" });
        const doc = await userChallengesCol.findOne({ _id: new ObjectId(id) });
        if (!doc) return res.status(404).send({ message: "Not found" });
        await userChallengesCol.deleteOne({ _id: new ObjectId(id) });
        await challengesCol.updateOne({ _id: new ObjectId(doc.challengeId) }, { $inc: { participants: -1 } });
        res.send({ ok: true, message: "Deleted" });
      } catch {
        res.status(500).send({ ok: false, message: "Could not delete user challenge" });
      }
    });



    app.use("/api/*", (req, res) => {
      res.status(404).send({ ok: false, message: "API route not found" });
    });
  } catch (err) {
    console.error(err);
  }
}



run().catch(console.dir);



app.listen(PORT, () => {
  console.log(`Server started on port ${PORT}`);
});