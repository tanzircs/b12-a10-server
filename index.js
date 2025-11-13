const dotenv = require("dotenv");
dotenv.config();

const express = require("express");
const cors = require("cors");
const { MongoClient, ObjectId, ServerApiVersion } = require("mongodb");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

const uri = process.env.MONGO_URI;

const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

async function run() {
  try {
    // await client.connect();
    const db = client.db("ecoTrackDB");
    const challengesCol = db.collection("challenges");
    const userChallengesCol = db.collection("userChallenges");
    const tipsCol = db.collection("tips");
    const eventsCol = db.collection("events");

    app.get("/", (req, res) =>
      res.send({ message: "EcoTrack API is running" })
    );

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
        if (category)
          filter.category = { $in: category.split(",").map((c) => c.trim()) };
        if (startDateFrom || startDateTo)
          filter.startDate = {
            ...(startDateFrom && { $gte: new Date(startDateFrom) }),
            ...(startDateTo && { $lte: new Date(startDateTo) }),
          };
        if (minParticipants || maxParticipants)
          filter.participants = {
            ...(minParticipants && { $gte: parseInt(minParticipants) }),
            ...(maxParticipants && { $lte: parseInt(maxParticipants) }),
          };
        if (search)
          filter.$or = [
            { title: new RegExp(search, "i") },
            { description: new RegExp(search, "i") },
            { category: new RegExp(search, "i") },
          ];
        const pageNum = parseInt(page) || 1;
        const perPage = parseInt(limit) || 20;
        const skip = (pageNum - 1) * perPage;
        let cursor = challengesCol.find(filter);
        if (sortBy === "participants")
          cursor = cursor.sort({ participants: -1 });
        else if (sortBy === "startDate") cursor = cursor.sort({ startDate: 1 });
        else cursor = cursor.sort({ createdAt: -1 });
        const total = await cursor.count();
        const data = await cursor.skip(skip).limit(perPage).toArray();
        res.send({ ok: true, total, page: pageNum, perPage, data });
      } catch {
        res
          .status(500)
          .send({ ok: false, message: "Server error fetching challenges" });
      }
    });

    app.get("/api/challenges/:id", async (req, res) => {
      try {
        const id = req.params.id;
        if (!ObjectId.isValid(id))
          return res.status(400).send({ message: "Invalid ID" });
        const challenge = await challengesCol.findOne({
          _id: new ObjectId(id),
        });
        if (!challenge)
          return res.status(404).send({ message: "Challenge not found" });
        res.send({ ok: true, data: challenge });
      } catch {
        res.status(500).send({ ok: false, message: "Server error" });
      }
    });

    app.post("/api/challenges", async (req, res) => {
      try {
        const body = req.body;
        const required = [
          "title",
          "category",
          "description",
          "duration",
          "impactMetric",
          "startDate",
          "endDate",
        ];
        for (const key of required)
          if (!body[key])
            return res
              .status(400)
              .send({ ok: false, message: `${key} is required` });
        const duration = parseInt(body.duration);
        const participants = parseInt(body.participants) || 0;
        const startDate = new Date(body.startDate);
        const endDate = new Date(body.endDate);
        if (isNaN(duration))
          return res
            .status(400)
            .send({ ok: false, message: "duration must be a number" });
        if (isNaN(startDate.getTime()))
          return res
            .status(400)
            .send({ ok: false, message: "Invalid startDate" });
        if (isNaN(endDate.getTime()))
          return res
            .status(400)
            .send({ ok: false, message: "Invalid endDate" });
        const newChallenge = {
          title: body.title,
          category: body.category,
          description: body.description,
          duration,
          target: body.target || "",
          participants,
          impactMetric: body.impactMetric,
          createdBy: body.createdBy || "admin@ecotrack.com",
          startDate,
          endDate,
          imageUrl: body.imageUrl || "",
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        const result = await challengesCol.insertOne(newChallenge);
        res.send({ ok: true, insertedId: result.insertedId });
      } catch (err) {
        console.error(err);
        res.status(500).send({
          ok: false,
          message: "Could not create challenge",
          error: err.message,
        });
      }
    });

    app.patch("/api/challenges/:id", async (req, res) => {
      try {
        const id = req.params.id;
        if (!ObjectId.isValid(id))
          return res.status(400).send({ message: "Invalid ID" });
        const updates = { ...req.body, updatedAt: new Date() };
        if (updates.startDate) updates.startDate = new Date(updates.startDate);
        if (updates.endDate) updates.endDate = new Date(updates.endDate);
        if (updates.duration) updates.duration = parseInt(updates.duration);
        if (updates.participants)
          updates.participants = parseInt(updates.participants);
        const result = await challengesCol.updateOne(
          { _id: new ObjectId(id) },
          { $set: updates }
        );
        if (result.matchedCount === 0)
          return res.status(404).send({ message: "Challenge not found" });
        res.send({ ok: true, modifiedCount: result.modifiedCount });
      } catch {
        res
          .status(500)
          .send({ ok: false, message: "Could not update challenge" });
      }
    });

    app.delete("/api/challenges/:id", async (req, res) => {
      try {
        const id = req.params.id;
        if (!ObjectId.isValid(id))
          return res.status(400).send({ message: "Invalid ID" });
        const result = await challengesCol.deleteOne({ _id: new ObjectId(id) });
        if (result.deletedCount === 0)
          return res.status(404).send({ message: "Challenge not found" });
        await userChallengesCol.deleteMany({ challengeId: id });
        res.send({ ok: true, deletedCount: result.deletedCount });
      } catch {
        res
          .status(500)
          .send({ ok: false, message: "Could not delete challenge" });
      }
    });

    app.post("/api/challenges/join/:id", async (req, res) => {
      try {
        const challengeId = req.params.id;
        const { userId } = req.body;
        if (!userId)
          return res
            .status(400)
            .send({ message: "userId is required in body" });
        if (!ObjectId.isValid(challengeId))
          return res.status(400).send({ message: "Invalid challenge ID" });
        const exists = await userChallengesCol.findOne({ challengeId, userId });
        if (exists)
          return res.status(400).send({ message: "User already joined" });
        const newUserChallenge = {
          userId,
          challengeId,
          status: "Not Started",
          progress: 0,
          joinDate: new Date(),
          updatedAt: new Date(),
        };
        await userChallengesCol.insertOne(newUserChallenge);
        await challengesCol.updateOne(
          { _id: new ObjectId(challengeId) },
          { $inc: { participants: 1 } }
        );
        res.send({ ok: true, message: "Joined challenge" });
      } catch {
        res
          .status(500)
          .send({ ok: false, message: "Could not join challenge" });
      }
    });

    // app.get("/api/user-challenges", async (req, res) => {
    //   try {
    //     const { userId } = req.query;
    //     if (!userId) return res.status(400).send({ message: "userId query required" });
    //     const items = await userChallengesCol.find({ userId }).toArray();
    //     res.send({ ok: true, data: items });
    //   } catch { res.status(500).send({ ok: false, message: "Could not fetch user challenges" }); }
    // });

    app.get("/api/user-challenges", async (req, res) => {
      try {
        const { userId } = req.query;
        if (!userId)
          return res.status(400).send({ message: "userId query required" });

        // MongoDB Aggregation (Join)
        const items = await userChallengesCol
          .aggregate([
            { $match: { userId: userId } },
            {
              $addFields: {
                challengeObjectId: { $toObjectId: "$challengeId" },
              },
            },
            {
              $lookup: {
                from: "challenges",
                localField: "challengeObjectId",
                foreignField: "_id",
                as: "challengeDetailsArray",
              },
            },
            {
              $unwind: "$challengeDetailsArray",
            },
            {
              $project: {
                _id: 1,
                userId: 1,
                challengeId: 1,
                status: 1,
                progress: 1,
                joinDate: 1,
                challengeDetails: "$challengeDetailsArray",
              },
            },
          ])
          .toArray();

        res.send({ ok: true, data: items });
      } catch (err) {
        console.error(err);
        res
          .status(500)
          .send({ ok: false, message: "Could not fetch user challenges" });
      }
    });

    app.patch("/api/user-challenges/:id", async (req, res) => {
      try {
        const id = req.params.id;
        if (!ObjectId.isValid(id))
          return res.status(400).send({ message: "Invalid ID" });
        const updates = { ...req.body, updatedAt: new Date() };
        if (updates.progress) updates.progress = parseFloat(updates.progress);
        const result = await userChallengesCol.updateOne(
          { _id: new ObjectId(id) },
          { $set: updates }
        );
        if (result.matchedCount === 0)
          return res.status(404).send({ message: "User challenge not found" });
        res.send({ ok: true, modifiedCount: result.modifiedCount });
      } catch {
        res
          .status(500)
          .send({ ok: false, message: "Could not update user challenge" });
      }
    });

    app.delete("/api/user-challenges/:id", async (req, res) => {
      try {
        const id = req.params.id;
        if (!ObjectId.isValid(id))
          return res.status(400).send({ message: "Invalid ID" });
        const doc = await userChallengesCol.findOne({ _id: new ObjectId(id) });
        if (!doc) return res.status(404).send({ message: "Not found" });
        await userChallengesCol.deleteOne({ _id: new ObjectId(id) });
        await challengesCol.updateOne(
          { _id: new ObjectId(doc.challengeId) },
          { $inc: { participants: -1 } }
        );
        res.send({ ok: true, message: "Deleted" });
      } catch {
        res
          .status(500)
          .send({ ok: false, message: "Could not delete user challenge" });
      }
    });

    app.get("/api/tips", async (req, res) => {
      try {
        const limit = parseInt(req.query.limit) || 50;
        const tips = await tipsCol
          .find()
          .sort({ createdAt: -1 })
          .limit(limit)
          .toArray();
        res.send({ ok: true, data: tips });
      } catch {
        res.status(500).send({ ok: false, message: "Could not fetch tips" });
      }
    });

    app.post("/api/tips", async (req, res) => {
      try {
        const { title, content, category, author, authorName } = req.body;
        if (!title || !content || !author)
          return res
            .status(400)
            .send({ message: "title, content and author are required" });
        const newTip = {
          title,
          content,
          category: category || "General",
          author,
          authorName: authorName || author,
          upvotes: parseInt(req.body.upvotes) || 0,
          createdAt: new Date(),
        };
        const result = await tipsCol.insertOne(newTip);
        res.send({ ok: true, insertedId: result.insertedId });
      } catch {
        res.status(500).send({ ok: false, message: "Could not create tip" });
      }
    });

    app.patch("/api/tips/:id", async (req, res) => {
      try {
        const id = req.params.id;
        if (!ObjectId.isValid(id))
          return res.status(400).send({ message: "Invalid ID" });
        const updates = { ...req.body };
        const result = await tipsCol.updateOne(
          { _id: new ObjectId(id) },
          { $set: updates }
        );
        if (result.matchedCount === 0)
          return res.status(404).send({ message: "Tip not found" });
        res.send({ ok: true, modifiedCount: result.modifiedCount });
      } catch {
        res.status(500).send({ ok: false, message: "Could not update tip" });
      }
    });

    app.delete("/api/tips/:id", async (req, res) => {
      try {
        const id = req.params.id;
        if (!ObjectId.isValid(id))
          return res.status(400).send({ message: "Invalid ID" });
        const result = await tipsCol.deleteOne({ _id: new ObjectId(id) });
        if (result.deletedCount === 0)
          return res.status(404).send({ message: "Tip not found" });
        res.send({ ok: true, deletedCount: result.deletedCount });
      } catch {
        res.status(500).send({ ok: false, message: "Could not delete tip" });
      }
    });

    app.get("/api/events", async (req, res) => {
      try {
        const limit = parseInt(req.query.limit) || 20;
        const now = new Date();
        const events = await eventsCol
          .find({ date: { $gte: now } })
          .sort({ date: 1 })
          .limit(limit)
          .toArray();
        res.send({ ok: true, data: events });
      } catch {
        res.status(500).send({ ok: false, message: "Could not fetch events" });
      }
    });

    app.get("/api/user-challenges/:id", async (req, res) => {
      try {
        const id = req.params.id;
        if (!ObjectId.isValid(id))
          return res.status(400).send({ message: "Invalid ID" });

        const items = await userChallengesCol
          .aggregate([
            { $match: { _id: new ObjectId(id) } },
            {
              $addFields: {
                challengeObjectId: { $toObjectId: "$challengeId" },
              },
            },
            {
              $lookup: {
                from: "challenges",
                localField: "challengeObjectId",
                foreignField: "_id",
                as: "challengeDetailsArray",
              },
            },
            {
              $unwind: "$challengeDetailsArray",
            },
            {
              $project: {
                _id: 1,
                userId: 1,
                challengeId: 1,
                status: 1,
                progress: 1,
                joinDate: 1,
                challengeDetails: "$challengeDetailsArray",
              },
            },
          ])
          .toArray();

        if (items.length === 0) {
          return res
            .status(404)
            .send({ ok: false, message: "Activity not found" });
        }

        res.send({ ok: true, data: items[0] });
      } catch (err) {
        console.error(err);
        res.status(500).send({
          ok: false,
          message: "Could not fetch user challenge details",
        });
      }
    });

    app.post("/api/events", async (req, res) => {
      try {
        const {
          title,
          description,
          date,
          location,
          organizer,
          maxParticipants,
        } = req.body;
        if (!title || !date || !location)
          return res
            .status(400)
            .send({ message: "title, date and location are required" });
        const newEvent = {
          title,
          description: description || "",
          date: new Date(date),
          location,
          organizer: organizer || "",
          maxParticipants: parseInt(maxParticipants) || 0,
          currentParticipants: 0,
          createdAt: new Date(),
        };
        const result = await eventsCol.insertOne(newEvent);
        res.send({ ok: true, insertedId: result.insertedId });
      } catch {
        res.status(500).send({ ok: false, message: "Could not create event" });
      }
    });

    app.patch("/api/events/:id", async (req, res) => {
      try {
        const id = req.params.id;
        if (!ObjectId.isValid(id))
          return res.status(400).send({ message: "Invalid ID" });
        const updates = { ...req.body, updatedAt: new Date() };
        if (updates.date) updates.date = new Date(updates.date);
        const result = await eventsCol.updateOne(
          { _id: new ObjectId(id) },
          { $set: updates }
        );
        if (result.matchedCount === 0)
          return res.status(404).send({ message: "Event not found" });
        res.send({ ok: true, modifiedCount: result.modifiedCount });
      } catch {
        res.status(500).send({ ok: false, message: "Could not update event" });
      }
    });

    app.delete("/api/events/:id", async (req, res) => {
      try {
        const id = req.params.id;
        if (!ObjectId.isValid(id))
          return res.status(400).send({ message: "Invalid ID" });
        const result = await eventsCol.deleteOne({ _id: new ObjectId(id) });
        if (result.deletedCount === 0)
          return res.status(404).send({ message: "Event not found" });
        res.send({ ok: true, deletedCount: result.deletedCount });
      } catch {
        res.status(500).send({ ok: false, message: "Could not delete event" });
      }
    });

    app.get("/api/stats/community", async (req, res) => {
      try {
        const totalChallenges = await challengesCol.countDocuments();
        const totalParticipantsAgg = await challengesCol
          .aggregate([
            { $group: { _id: null, total: { $sum: "$participants" } } },
          ])
          .toArray();
        const totalParticipants = totalParticipantsAgg[0]?.total || 0;
        const impactAgg = await challengesCol
          .aggregate([
            { $match: { estimatedImpactValue: { $exists: true } } },
            {
              $group: {
                _id: null,
                totalImpact: { $sum: "$estimatedImpactValue" },
              },
            },
          ])
          .toArray();
        const totalImpact = impactAgg[0]?.totalImpact || 0;
        res.send({ ok: true, totalChallenges, totalParticipants, totalImpact });
      } catch {
        res.status(500).send({ ok: false, message: "Could not compute stats" });
      }
    });

    app.use("/api", (req, res) =>
      res.status(404).send({ ok: false, message: "API route not found" })
    );
  } catch (err) {
    console.error(err);
  }
}

run().catch(console.dir);

// app.listen(PORT, () => console.log(`Server started on port ${PORT}`));

module.exports = app;
