# MarketFixer

A minimal Python HTTP service packaged with Docker.

## Run with Docker

Build the image:

```sh
docker build -t marketfixer .
```

Start the service on port 8000:

```sh
docker run --rm -p 8000:8000 marketfixer
```

Visit [http://localhost:8000](http://localhost:8000) or check
[http://localhost:8000/health](http://localhost:8000/health).

## Run locally

Requires Python 3.12 or later:

```sh
python main.py
```
