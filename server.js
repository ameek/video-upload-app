const express = require("express");
const { Storage } = require("@google-cloud/storage");
const { TranscoderServiceClient } = require("@google-cloud/video-transcoder");
const multer = require("multer");
const { v4: uuidv4 } = require("uuid");
const { PrismaClient } = require("@prisma/client");
const bodyParser = require("body-parser");
const { calculateTranscodingDuration } = require("./util");
const { PubSub } = require("@google-cloud/pubsub");

const app = express();
const prisma = new PrismaClient();
const storage = new Storage();
const transcoderClient = new TranscoderServiceClient();
const pubsubClient = new PubSub();

// Read the .env file
const bucketName = process.env.BUCKET_NAME;
const projectId = process.env.PROJECT_ID;
const location = process.env.LOCATION;
const topicName = process.env.PUBSUB_TOPIC_NAME;
const subscriptionName = process.env.PUBSUB_SUBSCRIPTION_NAME;

// Middleware to parse JSON bodies
app.use(bodyParser.json());

// Middleware to handle file uploads
const upload = multer({ storage: multer.memoryStorage() });

// Define the routes
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

    // Initiate video processing
    const [operation] = await transcoderClient.createJob({
      parent: transcoderClient.locationPath(projectId, location),
      job: {
        inputUri: `gs://${bucketName}/${blob.name}`,
        outputUri: `gs://${bucketName}/output/${uuid}/`,
        templateId: "preset/web-hd", // Example preset, replace with your actual template ID if different
        config: {
          muxStreams: [
            {
              key: "sd", // Add a unique key for this stream configuration
              container: "mp4",
              elementaryStreams: ["video-stream0", "audio-stream0"],
            },
            // Add other muxStreams configurations as needed, each with a unique key
          ],
         
          elementaryStreams: [
            {
              key: "video-stream0",
              videoStream: {
                h264: {
                  heightPixels: 360,
                  widthPixels: 640,
                  bitrateBps: 550000,
                  frameRate: 60,
                },
              },
            },
            {
              key: "audio-stream0",
              audioStream: {
                codec: "aac",
                bitrateBps: 64000,
              },
            },
          ],

          pubsubDestination: {
            topic: `projects/${projectId}/topics/${topicName}`,
          },
        },
      },
    });

    if (!operation.name) {
      //rollback the video record
      await prisma.video.delete({
        where: { uuid },
      });
      await storage.bucket(bucketName).file(blob.name).delete();

      return res.status(500).send("Error creating transcoding job removing the video record.");
    }
    const transcodingJobId = operation.name.split("/").pop();
    console.log(`Created job: ${transcodingJobId}`);

    await prisma.video.update({
      where: { uuid },
      data: {
        transcodingJobId: transcodingJobId,
        transcodingJobStatus: "processing",
      },
    });

    res.status(200).send({ uuid, url: publicUrl, jobName: operation.name });
  });

  blobStream.end(file.buffer);
});


// Handle the Pub/Sub push endpoint 
// deprecated
app.post("/pubsub/push", async (req, res) => {
  const message = req.body.message;

  if (!message) {
    return res.status(400).send("No message received.");
  }

  // Decode the base64 message data
  const buffer = Buffer.from(message.data, "base64");
  const pubsubMessage = JSON.parse(buffer.toString("utf-8"));

  console.log(`Received pub/sub message: ${JSON.stringify(pubsubMessage)}`);

  const { jobName, status } = pubsubMessage;

  try {
    // Update the job status in the database
    const updateResponse = await prisma.video.update({
      where: { transcodingJobId: jobName },
      data: { transcodingJobStatus: status },
    });

    res.status(200).send({ status, updateResponse });
  } catch (error) {
    console.error(error);

    if (error.code === "P2025") {
      return res.status(404).send("Error: Record to update not found.");
    }

    res.status(500).send("Error updating job status");
  }
});

// manually check the job status
app.get("/job-status/:jobName", async (req, res) => {
  const { jobName } = req.params;

  try {
    const fullJobName = transcoderClient.jobPath(projectId, location, jobName);
    const [job] = await transcoderClient.getJob({ name: fullJobName });
    res.status(200).send({ status: job.state });
  } catch (error) {
    console.error(error);
    res.status(500).send("Error fetching job status");
  }
});

// manually update the job status
app.get("/update-job-status/:jobName", async (req, res) => {
  const { jobName } = req.params;

  try {
    const fullJobName = transcoderClient.jobPath(projectId, location, jobName);
    const [job] = await transcoderClient.getJob({ name: fullJobName });
    const transcodingTime = calculateTranscodingDuration(
      job.startTime,
      job.endTime
    );
    console.log(job);
    console.log("transcodingTime:", transcodingTime);
    const updateResponse = await prisma.video.update({
      where: { transcodingJobId: jobName },
      data: {
        transcodingJobStatus: job.state,
        transcodingJobProcessTime: transcodingTime,
      },
    });

    res.status(200).send({ status: job.state, updateResponse });
  } catch (error) {
    console.error(error);

    // Check if the error code is P2025, indicating the record was not found
    if (error.code === "P2025") {
      return res.status(404).send("Error: Record to update not found.");
    }

    res.status(500).send("Error updating job status");
  }
});

// Corrected function to handle transcoding time
async function calculateJobTime(transcodingJobId) {
  try {
    const fullJobName = transcoderClient.jobPath(
      projectId,
      location,
      transcodingJobId
    );
    const [job] = await transcoderClient.getJob({ name: fullJobName });
    const transcodingTime = calculateTranscodingDuration(
      job.startTime,
      job.endTime
    );
    return transcodingTime; // Assuming you want to return the calculated time
  } catch (error) {
    console.error(error);
  }
}

// New function to handle pulling messages from the subscription
async function pullMessages() {
  const subscription = pubsubClient.subscription(subscriptionName);
  
  const messageHandler = async (message) => {
    const pubsubMessage = JSON.parse(
      Buffer.from(message.data, "base64").toString()
    );

    const transcodingJobId = pubsubMessage.job.name.split("/").pop();

    console.log(
      `Received job ${transcodingJobId} with status ${pubsubMessage.job.state}`
    );

    // Validate message contents
    if (!pubsubMessage) {
      console.error("Received message with missing jobName or status");
      return;
    }
    console.log(
      `Received message for job ${pubsubMessage.job.name} with status ${pubsubMessage.job.state}`
    );
    // Calculate the transcoding time
    const transcodingTime = await calculateJobTime(transcodingJobId);
    try {
      await prisma.video.update({
        where: { transcodingJobId: transcodingJobId },
        data: {
          transcodingJobStatus:pubsubMessage.job.state,
          transcodingJobProcessTime: transcodingTime,
        },
      });
      message.ack();
    } catch (error) {
      console.error("Error updating job status in database:", error);
      message.nack();
    }
  };
  subscription.on("message", messageHandler);
  console.log(`Listening for messages on ${subscriptionName}`);
}

// Start the message pulling function
pullMessages().catch(console.error);

// Start the server
const PORT = process.env.PORT || 3010;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
