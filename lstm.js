/* =========================================================
   LSTM.JS
   TensorFlow.js - Vercel

   Input:
   1. Suhu
   2. Kelembapan
   3. Kecepatan Angin
   4. Arah Angin
   5. Tinggi Muka Air Laut

   Lookback  : 24 jam
   Forecast  : 168 jam / 7 hari
   ========================================================= */

(function () {

  "use strict";


  // =====================================================
  // FITUR
  // =====================================================

  const FEATURES = [

    "suhu",

    "kelembapan",

    "kecepatan_angin",

    "arah_sin",

    "arah_cos",

    "tinggi_muka_air"

  ];


  const OUTPUT_NAMES = [

    "suhu",

    "kelembapan",

    "kecepatan_angin",

    "arah_sin",

    "arah_cos",

    "tinggi_muka_air"

  ];


  // =====================================================
  // KONFIGURASI
  // =====================================================

  const DEFAULT = {

    lookback: 24,

    forecastHours: 168,

    epochs: 200,

    batchSize: 16,

    learningRate: 0.001,

    lstmUnits: 32,

    denseUnits: 16,

    validationSplit: 0.20

  };


  // =====================================================
  // CEK TENSORFLOW
  // =====================================================

  function requireTF() {

    if (
      typeof tf === "undefined"
    ) {

      throw new Error(
        "TensorFlow.js belum dimuat."
      );

    }

  }


  // =====================================================
  // FIREBASE
  // =====================================================

  async function getFirebaseData(
    url
  ) {

    const response =
      await fetch(
        url,
        {
          method: "GET",
          cache: "no-store"
        }
      );


    if (
      !response.ok
    ) {

      throw new Error(

        "Firebase HTTP " +
        response.status +
        ": " +
        response.statusText

      );

    }


    const data =
      await response.json();


    if (
      data === null
    ) {

      throw new Error(
        "Firebase tidak mengembalikan data."
      );

    }


    return data;

  }


  // =====================================================
  // OBJECT FIREBASE → ARRAY
  // =====================================================

  function toArray(
    raw
  ) {

    if (
      Array.isArray(raw)
    ) {

      return raw.filter(
        Boolean
      );

    }


    if (
      raw &&
      typeof raw === "object"
    ) {

      return Object.entries(
        raw
      ).map(
        ([key, value]) => {

          if (
            value &&
            typeof value === "object"
          ) {

            return {

              ...value,

              _firebaseKey:
                key

            };

          }


          return {

            _firebaseKey:
              key,

            value:
              value

          };

        }
      );

    }


    return [];

  }


  // =====================================================
  // AMBIL ANGKA
  // =====================================================

  function firstNumber(
    obj,
    keys
  ) {

    for (
      const key of keys
    ) {

      if (
        obj[key] !== undefined &&
        obj[key] !== null &&
        obj[key] !== ""
      ) {

        const number =
          Number(
            obj[key]
          );


        if (
          Number.isFinite(
            number
          )
        ) {

          return number;

        }

      }

    }


    return null;

  }


  // =====================================================
  // DATETIME
  // =====================================================

  function parseDatetime(
    row
  ) {

    const candidates = [

      row.Datetime,

      row.datetime,

      row.timestamp,

      row.time,

      row.waktu,

      row.tanggal

    ];


    for (
      const value of candidates
    ) {

      if (
        value === undefined ||
        value === null ||
        value === ""
      ) {

        continue;

      }


      if (
        typeof value ===
        "number"
      ) {

        const milliseconds =
          value <
          100000000000
            ? value * 1000
            : value;


        const date =
          new Date(
            milliseconds
          );


        if (
          !Number.isNaN(
            date.getTime()
          )
        ) {

          return date;

        }

      }


      const date =
        new Date(
          value
        );


      if (
        !Number.isNaN(
          date.getTime()
        )
      ) {

        return date;

      }

    }


    // Tahun / Bulan / Hari / Jam

    const tahun =
      firstNumber(
        row,
        [
          "Tahun",
          "tahun",
          "year"
        ]
      );


    const bulan =
      firstNumber(
        row,
        [
          "Bulan",
          "bulan",
          "month"
        ]
      );


    const hari =
      firstNumber(
        row,
        [
          "Hari",
          "hari",
          "day"
        ]
      );


    const jam =
      firstNumber(
        row,
        [
          "Jam",
          "jam",
          "hour"
        ]
      ) ?? 0;


    const menit =
      firstNumber(
        row,
        [
          "Menit",
          "menit",
          "minute"
        ]
      ) ?? 0;


    const detik =
      firstNumber(
        row,
        [
          "Detik",
          "detik",
          "second"
        ]
      ) ?? 0;


    if (
      tahun !== null &&
      bulan !== null &&
      hari !== null
    ) {

      return new Date(

        tahun,

        bulan - 1,

        hari,

        jam,

        menit,

        detik

      );

    }


    return null;

  }


  // =====================================================
  // NORMALISASI ARAH
  // =====================================================

  function normalizeDirection(
    degree
  ) {

    if (
      !Number.isFinite(
        degree
      )
    ) {

      return null;

    }


    let value =
      degree % 360;


    if (
      value < 0
    ) {

      value += 360;

    }


    return value;

  }


  // =====================================================
  // BACA ARAH ANGIN
  // =====================================================

  function directionFromRow(
    row
  ) {

    const value =
      firstNumber(
        row,
        [

          "arah_angin",

          "arah",

          "arah_angin_derajat",

          "wind_direction",

          "direction",

          "derajat"

        ]
      );


    if (
      value !== null
    ) {

      return normalizeDirection(
        value
      );

    }


    const text =
      String(

        row.arah_angin ??
        row.arah ??
        row.direction ??
        ""

      )
      .toLowerCase()
      .trim();


    const map = {

      "utara": 0,
      "u": 0,
      "north": 0,
      "n": 0,

      "timur laut": 45,
      "tl": 45,
      "northeast": 45,
      "ne": 45,

      "timur": 90,
      "t": 90,
      "east": 90,
      "e": 90,

      "tenggara": 135,
      "tg": 135,
      "southeast": 135,
      "se": 135,

      "selatan": 180,
      "s": 180,
      "south": 180,

      "barat daya": 225,
      "bd": 225,
      "southwest": 225,
      "sw": 225,

      "barat": 270,
      "b": 270,
      "west": 270,
      "w": 270,

      "barat laut": 315,
      "bl": 315,
      "northwest": 315,
      "nw": 315

    };


    if (
      Object.prototype.hasOwnProperty.call(
        map,
        text
      )
    ) {

      return map[text];

    }


    return null;

  }


  // =====================================================
  // KONVERSI DATA FIREBASE
  // =====================================================

  function convertFirebaseData(
    raw,
    options = {}
  ) {

    const sensorHeight =
      Number(
        options.sensorHeight ??
        2.5
      );


    const rows =
      toArray(
        raw
      );


    const result = [];


    for (
      const row of rows
    ) {

      const datetime =
        parseDatetime(
          row
        );


      if (
        !datetime
      ) {

        continue;

      }


      const suhu =
        firstNumber(
          row,
          [
            "suhu",
            "temperature",
            "temp"
          ]
        );


      const kelembapan =
        firstNumber(
          row,
          [
            "kelembapan",
            "humidity",
            "hum"
          ]
        );


      const kecepatan =
        firstNumber(
          row,
          [

            "kecepatan_ms",

            "kecepatan_angin",

            "kecepatan",

            "wind_speed",

            "wind_speed_ms"

          ]
        );


      const arah =
        directionFromRow(
          row
        );


      let tinggiAir =
        firstNumber(
          row,
          [

            "tinggi_muka_air",

            "tinggi_permukaan_laut",

            "tinggiAir",

            "sea_level",

            "water_level"

          ]
        );


      // ===============================================
      // Jika tinggi air tidak ada
      // hitung dari jarak sensor
      // ===============================================

      if (
        tinggiAir === null
      ) {

        const jarakMeter =
          firstNumber(
            row,
            [

              "jarak_meter",

              "distance_meter",

              "jarak_m"

            ]
          );


        const jarakCm =
          firstNumber(
            row,
            [

              "jarak_cm",

              "distance_cm",

              "jarak"

            ]
          );


        if (
          jarakMeter !== null
        ) {

          tinggiAir =
            Math.max(
              0,
              sensorHeight -
              jarakMeter
            );

        }

        else if (
          jarakCm !== null
        ) {

          tinggiAir =
            Math.max(

              0,

              sensorHeight -
              jarakCm / 100

            );

        }

      }


      if (

        suhu === null ||

        kelembapan === null ||

        kecepatan === null ||

        arah === null ||

        tinggiAir === null

      ) {

        continue;

      }


      const radian =
        arah *
        Math.PI /
        180;


      result.push({

        datetime,

        suhu,

        kelembapan,

        kecepatan_angin:
          Math.max(
            0,
            kecepatan
          ),

        arah_angin:
          normalizeDirection(
            arah
          ),

        arah_sin:
          Math.sin(
            radian
          ),

        arah_cos:
          Math.cos(
            radian
          ),

        tinggi_muka_air:
          tinggiAir

      });

    }


    result.sort(
      (a, b) =>
        a.datetime -
        b.datetime
    );


    return result;

  }


  // =====================================================
  // NORMALISASI PER JAM
  // =====================================================

  function floorHour(
    date
  ) {

    const d =
      new Date(
        date
      );


    d.setMinutes(
      0,
      0,
      0
    );


    return d;

  }


  function prepareHourlyData(
    data
  ) {

    const map =
      new Map();


    for (
      const row of data
    ) {

      const date =
        floorHour(
          row.datetime
        );


      map.set(

        date.getTime(),

        {

          ...row,

          datetime:
            date

        }

      );

    }


    return [

      ...map.values()

    ]
      .sort(
        (a, b) =>
          a.datetime -
          b.datetime
      );

  }


  // =====================================================
  // SCALER MIN MAX
  // =====================================================

  class MinMaxScaler {

    constructor() {

      this.min = [];

      this.max = [];

    }


    fit(
      matrix
    ) {

      const columns =
        matrix[0].length;


      this.min =
        Array(
          columns
        ).fill(
          Infinity
        );


      this.max =
        Array(
          columns
        ).fill(
          -Infinity
        );


      for (
        const row of matrix
      ) {

        for (
          let j = 0;
          j < columns;
          j++
        ) {

          this.min[j] =
            Math.min(
              this.min[j],
              row[j]
            );


          this.max[j] =
            Math.max(
              this.max[j],
              row[j]
            );

        }

      }

    }


    transform(
      matrix
    ) {

      return matrix.map(
        row =>

          row.map(
            (value, j) => {

              const range =
                this.max[j] -
                this.min[j];


              if (
                range === 0
              ) {

                return 0;

              }


              return (

                value -
                this.min[j]

              ) / range;

            }
          )

      );

    }


    inverse(
      matrix
    ) {

      return matrix.map(
        row =>

          row.map(
            (value, j) => {

              const range =
                this.max[j] -
                this.min[j];


              return (

                value *
                range

              ) +
              this.min[j];

            }
          )

      );

    }

  }


  // =====================================================
  // BARIS → FITUR
  // =====================================================

  function rowToFeatures(
    row
  ) {

    return [

      row.suhu,

      row.kelembapan,

      row.kecepatan_angin,

      row.arah_sin,

      row.arah_cos,

      row.tinggi_muka_air

    ];

  }


  // =====================================================
  // SEQUENCE
  // =====================================================

  function makeSequences(
    values,
    lookback
  ) {

    const X = [];

    const y = [];


    for (
      let i = lookback;
      i < values.length;
      i++
    ) {

      X.push(

        values.slice(
          i - lookback,
          i
        )

      );


      y.push(
        values[i]
      );

    }


    return {
      X,
      y
    };

  }


  // =====================================================
  // MODEL LSTM
  // =====================================================

  function createModel(
    config
  ) {

    requireTF();


    const model =
      tf.sequential();


    model.add(

      tf.layers.lstm({

        units:
          config.lstmUnits,

        inputShape: [

          config.lookback,

          FEATURES.length

        ]

      })

    );


    model.add(

      tf.layers.dense({

        units:
          config.denseUnits,

        activation:
          "relu"

      })

    );


    model.add(

      tf.layers.dense({

        units:
          FEATURES.length

      })

    );


    model.compile({

      optimizer:
        tf.train.adam(
          config.learningRate
        ),

      loss:
        "meanSquaredError",

      metrics:
        ["mae"]

    });


    return model;

  }


  // =====================================================
  // EVALUASI
  // =====================================================

  function regressionMetrics(
    actual,
    predicted
  ) {

    const n =
      actual.length;


    const columns =
      actual[0].length;


    const output = {};


    for (
      let j = 0;
      j < columns;
      j++
    ) {

      let absolute =
        0;


      let square =
        0;


      let sum =
        0;


      for (
        let i = 0;
        i < n;
        i++
      ) {

        const error =
          predicted[i][j] -
          actual[i][j];


        absolute +=
          Math.abs(
            error
          );


        square +=
          error * error;


        sum +=
          actual[i][j];

      }


      const mean =
        sum / n;


      let total =
        0;


      let residual =
        0;


      for (
        let i = 0;
        i < n;
        i++
      ) {

        total +=
          Math.pow(
            actual[i][j] -
            mean,
            2
          );


        residual +=
          Math.pow(
            actual[i][j] -
            predicted[i][j],
            2
          );

      }


      const MAE =
        absolute / n;


      const RMSE =
        Math.sqrt(
          square / n
        );


      const R2 =
        total === 0
          ? 0
          : 1 -
            residual /
            total;


      output[
        OUTPUT_NAMES[j]
      ] = {

        MAE,

        RMSE,

        R2

      };

    }


    return output;

  }


  // =====================================================
  // ERROR ARAH ANGIN
  // =====================================================

  function circularError(
    actual,
    predicted
  ) {

    let error =
      Math.abs(
        actual -
        predicted
      );


    if (
      error > 180
    ) {

      error =
        360 -
        error;

    }


    return error;

  }


  function directionMetrics(
    actual,
    predicted
  ) {

    const actualDeg = [];

    const predictedDeg = [];


    for (
      let i = 0;
      i < actual.length;
      i++
    ) {

      const a =
        Math.atan2(

          actual[i][3],

          actual[i][4]

        ) *
        180 /
        Math.PI;


      const p =
        Math.atan2(

          predicted[i][3],

          predicted[i][4]

        ) *
        180 /
        Math.PI;


      actualDeg.push(

        (
          a + 360
        ) % 360

      );


      predictedDeg.push(

        (
          p + 360
        ) % 360

      );

    }


    let absolute =
      0;


    let square =
      0;


    for (
      let i = 0;
      i < actualDeg.length;
      i++
    ) {

      const error =
        circularError(

          actualDeg[i],

          predictedDeg[i]

        );


      absolute +=
        error;


      square +=
        error *
        error;

    }


    return {

      MAE:
        absolute /
        actualDeg.length,

      RMSE:
        Math.sqrt(

          square /
          actualDeg.length

        )

    };

  }


  // =====================================================
  // TRAINING
  // =====================================================

  async function train(
    data,
    options = {}
  ) {

    requireTF();


    const config = {

      ...DEFAULT,

      ...options

    };


    if (
      data.length <=
      config.lookback + 10
    ) {

      throw new Error(
        "Jumlah data tidak cukup untuk training LSTM."
      );

    }


    const matrix =
      data.map(
        rowToFeatures
      );


    // 80% TRAINING

    const trainCount =
      Math.floor(
        matrix.length *
        0.80
      );


    const trainRaw =
      matrix.slice(
        0,
        trainCount
      );


    const testRaw =
      matrix.slice(

        Math.max(

          0,

          trainCount -
          config.lookback

        )

      );


    // SCALER HANYA FIT
    // PADA DATA TRAINING

    const scaler =
      new MinMaxScaler();


    scaler.fit(
      trainRaw
    );


    const trainScaled =
      scaler.transform(
        trainRaw
      );


    const testScaled =
      scaler.transform(
        testRaw
      );


    const trainSequence =
      makeSequences(

        trainScaled,

        config.lookback

      );


    const testSequence =
      makeSequences(

        testScaled,

        config.lookback

      );


    const xs =
      tf.tensor3d(
        trainSequence.X
      );


    const ys =
      tf.tensor2d(
        trainSequence.y
      );


    const model =
      createModel(
        config
      );


    let bestEpoch =
      null;


    let bestValidation =
      Infinity;


    const history =
      await model.fit(

        xs,

        ys,

        {

          epochs:
            config.epochs,

          batchSize:
            config.batchSize,

          validationSplit:
            config.validationSplit,

          shuffle:
            false,

          callbacks: {

            onEpochEnd:
            async function (
              epoch,
              logs
            ) {

              const validation =
                logs.val_loss ??
                logs.loss;


              if (
                validation <
                bestValidation
              ) {

                bestValidation =
                  validation;

                bestEpoch =
                  epoch + 1;

              }


              if (
                typeof
                config.onEpochEnd ===
                "function"
              ) {

                config.onEpochEnd(
                  epoch + 1,
                  logs
                );

              }


              await tf.nextFrame();

            }

          }

        }

      );


    // TEST

    const testX =
      tf.tensor3d(
        testSequence.X
      );


    const predictionTensor =
      model.predict(
        testX
      );


    const predictionScaled =
      await predictionTensor.array();


    const actualScaled =
      testSequence.y;


    const predicted =
      scaler.inverse(
        predictionScaled
      );


    const actual =
      scaler.inverse(
        actualScaled
      );


    const metrics =
      regressionMetrics(

        actual,

        predicted

      );


    metrics.arah_angin =
      directionMetrics(

        actualScaled,

        predictionScaled

      );


    xs.dispose();

    ys.dispose();

    testX.dispose();

    predictionTensor.dispose();


    return {

      model,

      scaler,

      config,

      history:
        history.history,

      metrics,

      bestEpoch,

      trainCount,

      testCount:
        testSequence.X.length

    };

  }


  // =====================================================
  // FORECAST
  // =====================================================

  async function forecast(
    data,
    hours = 168,
    trainingResult
  ) {

    requireTF();


    if (
      !trainingResult ||
      !trainingResult.model
    ) {

      throw new Error(
        "Model LSTM belum tersedia."
      );

    }


    const model =
      trainingResult.model;


    const scaler =
      trainingResult.scaler;


    const config =
      trainingResult.config;


    const lookback =
      config.lookback;


    let recent =
      data
        .slice(
          -lookback
        )
        .map(
          rowToFeatures
        );


    if (
      recent.length <
      lookback
    ) {

      throw new Error(
        "Data terakhir harus minimal 24 jam."
      );

    }


    let scaled =
      scaler.transform(
        recent
      );


    const results = [];


    const lastDate =
      new Date(
        data[
          data.length - 1
        ].datetime
      );


    // ===============================================
    // PREDIKSI REKURSIF
    // ===============================================

    for (
      let hour = 1;
      hour <= hours;
      hour++
    ) {

      const input =
        tf.tensor3d(

          [
            scaled.slice(
              -lookback
            )
          ],

          [
            1,

            lookback,

            FEATURES.length

          ]

        );


      const prediction =
        model.predict(
          input
        );


      const predictionScaled =
        await prediction.array();


      input.dispose();

      prediction.dispose();


      const nextScaled =
        predictionScaled[0];


      scaled.push(
        nextScaled
      );


      const inverse =
        scaler.inverse(
          [
            nextScaled
          ]
        )[0];


      // Arah angin

      let direction =
        Math.atan2(

          inverse[3],

          inverse[4]

        ) *
        180 /
        Math.PI;


      direction =
        (
          direction +
          360
        ) % 360;


      const date =
        new Date(

          lastDate.getTime() +

          hour *
          3600000

        );


      results.push({

        datetime:
          formatDatetime(
            date
          ),

        suhu:
          inverse[0],

        kelembapan:
          inverse[1],

        kecepatan_angin:
          Math.max(
            0,
            inverse[2]
          ),

        arah_angin:
          direction,

        tinggi_muka_air:
          inverse[5]

      });


      await tf.nextFrame();

    }


    return results;

  }


  // =====================================================
  // FORMAT WAKTU
  // =====================================================

  function formatDatetime(
    date
  ) {

    const tahun =
      date.getFullYear();


    const bulan =
      String(
        date.getMonth() + 1
      ).padStart(
        2,
        "0"
      );


    const hari =
      String(
        date.getDate()
      ).padStart(
        2,
        "0"
      );


    const jam =
      String(
        date.getHours()
      ).padStart(
        2,
        "0"
      );


    return (

      tahun +
      "-" +
      bulan +
      "-" +
      hari +
      " " +
      jam +
      ":00"

    );

  }


  // =====================================================
  // EXPORT CSV
  // =====================================================

  function toCSV(
    data
  ) {

    if (
      !data.length
    ) {

      return "";

    }


    const headers = [

      "datetime",

      "suhu",

      "kelembapan",

      "kecepatan_angin",

      "arah_angin",

      "tinggi_muka_air"

    ];


    const lines = [

      headers.join(",")

    ];


    for (
      const row of data
    ) {

      lines.push(

        [

          row.datetime,

          row.suhu,

          row.kelembapan,

          row.kecepatan_angin,

          row.arah_angin,

          row.tinggi_muka_air

        ].join(",")

      );

    }


    return lines.join(
      "\n"
    );

  }


  // =====================================================
  // PUBLIC API
  // =====================================================

  window.LSTM = {

    FEATURES,

    DEFAULT,

    getFirebaseData,

    convertFirebaseData,

    prepareHourlyData,

    train,

    forecast,

    toCSV,

    formatDatetime

  };


})();