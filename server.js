const express = require('express');
const { Storage } = require('@google-cloud/storage');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const { PrismaClient } = require('@prisma/client');

const app = express();
const prisma = new PrismaClient();
const storage = new Storage();

const bucketName = 'test_upload_video_dummy_app';

// Middleware to handle file uploads
const upload = multer({ storage: multer.memoryStorage() });

app.post('/upload', upload.single('video'), async (req, res) => {
  const file = req.file;
  const uuid = uuidv4();

  if (!file) {
    return res.status(400).send('No file uploaded.');
  }

  const blob = storage.bucket(bucketName).file(`${uuid}-${file.originalname}`);
  const blobStream = blob.createWriteStream();

  blobStream.on('error', err => {
    console.error(err);
    res.status(500).send('Unable to upload the video.');
  });

  blobStream.on('finish', async () => {
    const publicUrl = `https://storage.googleapis.com/${bucketName}/${blob.name}`;
    
    await prisma.video.create({
      data: {
        uuid,
        url: publicUrl,
        status: 'uploaded'
      }
    });

    res.status(200).send({ uuid, url: publicUrl });
  });

  blobStream.end(file.buffer);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
