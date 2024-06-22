const express = require("express");
const { Storage } = require("@google-cloud/storage");
const { TranscoderServiceClient } = require("@google-cloud/video-transcoder");
const multer = require("multer");
const { v4: uuidv4 } = require("uuid");
const { PrismaClient } = require("@prisma/client");

const app = express();
const prisma = new PrismaClient();
const storage = new Storage();
const transcoderClient = new TranscoderServiceClient();

//read the .env file
const bucketName = process.env.BUCKET_NAME;
const projectId = process.env.PROJECT_ID;
const location = process.env.LOCATION;
const topicName = process.env.PUBSUB_TOPIC_NAME;

// Middleware to handle file uploads
const upload = multer({ storage: multer.memoryStorage() });

app.get("/", (req, res) => {
  res.send("Hello World!");
});

app.post("/upload", upload.single("video"), async (req, res) => {
  const file = req.file;
  const uuid = uuidv4();

  if (!file) {
    return res.status(400).send("No file uploaded.");
  }

  const blob = storage.bucket(bucketName).file(`${uuid}-${file.originalname}`);
  const blobStream = blob.createWriteStream();

  blobStream.on("error", (err) => {
    console.error(err);
    res.status(500).send("Unable to upload the video.");
  });

  blobStream.on("finish", async () => {
    const publicUrl = `https://storage.googleapis.com/${bucketName}/${blob.name}`;

    await prisma.video.create({
      data: {
        uuid,
        url: publicUrl,
        status: "uploaded",
      },
    });

    // // Initiate video processing
    // const [operation] = await transcoderClient.createJob({
    //   parent: transcoderClient.locationPath(projectId, location),
    //   job: {
    //     inputUri: `gs://${bucketName}/${blob.name}`,
    //     outputUri: `gs://${bucketName}/output/${uuid}/`,
    //     templateId: 'preset/web-hd', // Example preset, replace with your actual template ID if different
    //   },
    // });

    // console.log(`Created job: ${operation.name}`);

    // res.status(200).send({ uuid, url: publicUrl, jobName: operation.name });
    res.status(200).send({ uuid, url: publicUrl });
  });

  blobStream.end(file.buffer);
});

app.get("/job-status/:jobName", async (req, res) => {
  const { jobName } = req.params;

  try {
    const [job] = await transcoderClient.getJob({ name: jobName });
    res.status(200).send({ status: job.state });
  } catch (error) {
    console.error(error);
    res.status(500).send("Error fetching job status");
  }
});

app.get("/update-job-status/:jobName", async (req, res) => {
  const { jobName } = req.params;

  try {
    const [job] = await transcoderClient.getJob({ name: jobName });
    const uuid = job.inputUri.split("/").pop().split("-")[0]; // Extract UUID from inputUri

    await prisma.video.update({
      where: { uuid },
      data: { status: job.state },
    });

    res.status(200).send({ status: job.state });
  } catch (error) {
    console.error(error);
    res.status(500).send("Error updating job status");
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
