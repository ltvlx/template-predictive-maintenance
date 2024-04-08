# import Utility modules
from argparse import ArgumentError
import os
import ast
import datetime
import logging
from dotenv import load_dotenv

# import vendor-specific modules
from quixstreams import Application
from influxdb_client_3 import InfluxDBClient3

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

with open("./.env", 'a+') as file: pass  # make sure the .env file exists
load_dotenv("./.env") # load environment variables from .env file for local dev

for name, value in os.environ.items():
    print("{0}: {1}".format(name, value))

consumer_group_name = os.environ.get('CONSUMER_GROUP_NAME', "influxdb-data-writer")

# Create a Quix platform-specific application instead
app = Application.Quix(consumer_group=consumer_group_name, auto_create_topics=True, auto_offset_reset='earliest', use_changelog_topics=False)

input_topic = app.topic(os.environ["input"])

# Read the environment variable to determine the timestamp key. Default to timestmap if not defined
incoming_timestamp_key = os.environ.get('TIMESTAMP_KEY', "timestamp")

# Read the environment variable and convert it to a dictionary
tag_keys = ast.literal_eval(os.environ.get('INFLUXDB_TAG_KEYS', "[]"))
field_keys = ast.literal_eval(os.environ.get('INFLUXDB_FIELD_KEYS', "[]"))

# do some parameter/variable validation
influxdb_host = os.getenv("INFLUXDB_HOST", "")
if influxdb_host == "":
    raise ValueError("InfluxDB is required")

if not influxdb_host.startswith("https://"):
    influxdb_host = 'https://' + influxdb_host

# setup the influxdb3 client using values from environment variables
influx3_client = InfluxDBClient3(token=os.environ["INFLUXDB_TOKEN"],
                         host=os.environ["INFLUXDB_HOST"],
                         org=os.environ["INFLUXDB_ORG"],
                         database=os.environ["INFLUXDB_DATABASE"])
back_off_delay = 0
def send_data_to_influx(message):
    logger.info(f"Processing message: {message}")

    try:
        time.sleep(back_off_delay)
        # Get the measurement name to write data to
        measurement_name = os.environ.get('INFLUXDB_MEASUREMENT_NAME', "measurement1")

        # Initialize the tags and fields dictionaries
        tags = {}
        fields = {}

        # Iterate over the tag_dict and field_dict to populate tags and fields
        for tag_key in tag_keys:
            if tag_key in message:
                tags[tag_key] = message[tag_key]

        for field_key in field_keys:
            if field_key in message:
                fields[field_key] = message[field_key]

        logger.info(f"Using tag keys: {', '.join(tags.keys())}")
        logger.info(f"Using field keys: {', '.join(fields.keys())}")

        # Construct the points dictionary
        points = {
            "measurement": measurement_name,
            "tags": tags,
            "fields": fields,
            "time": message[incoming_timestamp_key]
        }

        influx3_client.write(record=points, write_precision="ms")
        
        logger.info(f"{str(datetime.datetime.utcnow())}: Persisted data to influxDb: {points}")
    except Exception as e:
        if back_off_delay < 5:
            back_off_delay += 0.5

        logger.info(f"{str(datetime.datetime.utcnow())}: Write failed")
        logger.info(e)

sdf = app.dataframe(input_topic)

sdf = sdf[sdf.contains(incoming_timestamp_key)]  # filter out imbound data without this column

sdf = sdf.apply(send_data_to_influx)

if __name__ == "__main__":
    logger.info("Starting application")
    try:
        app.run(sdf)
    except Exception as e:
        print(e)
