from pyspark.sql import SparkSession
from pyspark.sql.functions import explode, split, lower, col, trim

# 1. Crear la sesión Spark
spark = SparkSession.builder \
    .appName("WordCount-Clase") \
    .getOrCreate()

# Silenciar logs de INFO para ver solo lo necesario
spark.sparkContext.setLogLevel("WARN")

print("SparkSession creada")

# 2. Leer datos desde S3
INPUT_PATH  = "s3://mi-bucket/input/quijote.txt"
OUTPUT_PATH = "s3://mi-bucket/output/wordcount"

df = spark.read.text(INPUT_PATH)

print(f"Líneas leídas: {df.count()}")
df.show(5)

# 3. Transformaciones (lazy evaluation)
# Convertir a minúsculas, separar por espacios y hacer explode
words = df.select(
    explode(
        split(lower(col("value")), " ")
    ).alias("word")
)

# Limpiar espacios y quitar vacíos
words_clean = words \
    .withColumn("word", trim(col("word"))) \
    .filter(col("word") != "")

# Agrupar y contar las palabras
result = words_clean \
    .groupBy("word") \
    .count() \
    .orderBy("count", ascending=False)

# 4. Action (ejecución del plan)
print("\nTop 20 palabras más frecuentes:")
result.show(20)

# 5. Guardar resultado en S3
result.write \
    .mode("overwrite") \
    .option("header", "true") \
    .csv(OUTPUT_PATH)

print(f"\nResultado guardado en: {OUTPUT_PATH}")

# Cerrar la sesión
spark.stop()