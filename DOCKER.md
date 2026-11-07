# Docker

The container runs the Node.js service using Node.js 22.

Build the image:

```sh
docker build -t marketfixer .
```

Start the service in the background on port 8000:

```sh
docker run --rm -d --name marketfixer -p 8000:8000 marketfixer
```

Visit [http://localhost:8000](http://localhost:8000) or check
[http://localhost:8000/health](http://localhost:8000/health).

View container logs:

```sh
docker logs -f marketfixer
```

Stop the service:

```sh
docker stop marketfixer
```

The `--rm` option removes the container when it stops. To run it again, repeat
the `docker run` command above.

After changing the code, rebuild the image. If a container named `marketfixer`
is already running, stop it before starting the replacement:

```sh
docker build -t marketfixer .
docker stop marketfixer
docker run --rm -d --name marketfixer -p 8000:8000 marketfixer
```
