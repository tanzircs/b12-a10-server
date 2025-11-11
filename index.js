const express = require("express");
const cors = require("cors");
const { MongoClient, ObjectId, ServerApiVersion } = require("mongodb");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());


const uri =
  "mongodb+srv://b12a10:b12a10pass@cluster0.o1qvulf.mongodb.net/?appName=Cluster0";