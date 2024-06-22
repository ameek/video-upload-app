# video-upload-app
simple video upload app

# ENV
env is required for for service key json

# running  the app on docker

docker-compose build

docker-compose up -d

## Note
it may fail to run the node app in first place kindly try to manually run the node container 2 or 3 times then it will be running

# stop the docker
docker-compose down.

# upload the video api endpoint
[post] "http://localhost:3000/upload"

form -> select file 

it should upload a video to the GS