from pyspark.sql import SparkSession
from pyspark.sql.functions import explode, split, lower, col, trim

spark = SparkSession.builder \
    .appName("WordCount-Clase") \
    .getOrCreate()

spark.sparkContext.setLogLevel("WARN")

print("SparkSession creada")

INPUT_PATH  = "s3://mi-bucket/input/quijote.txt"
OUTPUT_PATH = "s3://mi-bucket/output/wordcount"

df = spark.read.text(INPUT_PATH)

print(f"Líneas leídas: {df.count()}")
df.show(5)

words = df.select(
    explode(
        split(lower(col("value")), " ")
    ).alias("word")
)

words_clean = words \
    .withColumn("word", trim(col("word"))) \
    .filter(col("word") != "")

result = words_clean \
    .groupBy("word") \
    .count() \
    .orderBy("count", ascending=False)

print("\nTop 20 palabras más frecuentes:")
result.show(20)

result.write \
    .mode("overwrite") \
    .option("header", "true") \
    .csv(OUTPUT_PATH)

print(f"\nResultado guardado en: {OUTPUT_PATH}")

spark.stop()
