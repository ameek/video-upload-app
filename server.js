const express = require("express");
const { Storage } = require("@google-cloud/storage");
const { TranscoderServiceClient } = require("@google-cloud/video-transcoder");
const multer = require("multer");
const { v4: uuidv4 } = require("uuid");
const { PrismaClient } = require("@prisma/client");
const bodyParser = require("body-parser");
const { calculateTranscodingDuration } = require("./util");

const app = express();
const prisma = new PrismaClient();
const storage = new Storage();
const transcoderClient = new TranscoderServiceClient();

// Read the .env file
const bucketName = process.env.BUCKET_NAME;
const projectId = process.env.PROJECT_ID;
const location = process.env.LOCATION;
const topicName = process.env.PUBSUB_TOPIC_NAME;

// Middleware to parse JSON bodies
app.use(bodyParser.json());

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
          //   //'config.elementaryStreams missing, expect at least one ElementaryStream'
          //   // 'config.elementaryStreams[0].videoStream.codecSettings missing, expect either h264, h265 or vp9',
          elementaryStreams: [
            // {
            //   videoStream: {
            //     h264: {
            //       profile: "high",
            //       preset: "veryfast",
            //       heightPixels: 360,
            //       widthPixels: 640,
            //       pixelFormat: "yuv420p",
            //       bitrateBps: 550000,
            //       rateControlMode: "vbr",
            //       crfLevel: 21,
            //       vbvSizeBits: 550000,
            //       vbvFullnessBits: 495000,
            //       entropyCoder: "cabac",
            //       bFrameCount: 3,
            //       frameRate: 30,
            //       aqStrength: 1,
            //     },
            //   },
            //   key: "video-stream0",
            // },
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

    // putting a guard condition to check if the operation name is not null
    if (!operation.name) {
      //rollback the video record
      //also delete from gcloud storage
      //also delete the record from the database
      await prisma.video.delete({
        where: { uuid },
      });
      await storage.bucket(bucketName).file(blob.name).delete();

      return res.status(500).send("Error creating transcoding job");
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

const PORT = process.env.PORT || 3010;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
