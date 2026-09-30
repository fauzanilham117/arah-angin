/* =========================================================
   LSTM.JS
   Firebase Realtime Database + TensorFlow.js + Vercel

   Firebase:
   cuaca/history

   INPUT:
   1. Suhu
   2. Kelembapan
   3. Kecepatan Angin
   4. Arah Angin Sin
   5. Arah Angin Cos
   6. Tinggi Muka Air

   LOOKBACK:
   24 jam

   FORECAST:
   168 jam / 7 hari
   ========================================================= */

(function () {

  "use strict";


  /* =======================================================
     KONFIGURASI FIREBASE
  ======================================================= */

  const FIREBASE_DATABASE_URL =
    "https://arah-angin-76f91-default-rtdb.asia-southeast1.firebasedatabase.app";


  const FIREBASE_HISTORY_URL =
    FIREBASE_DATABASE_URL +
    "/cuaca/history.json";


  /* =======================================================
     FITUR LSTM
  ======================================================= */

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


  /* =======================================================
     KONFIGURASI DEFAULT
  ======================================================= */

  const DEFAULT = {

    lookback: 24,

    forecastHours: 168,

    epochs: 100,

    batchSize: 16,

    learningRate: 0.001,

    lstmUnits: 32,

    denseUnits: 16,

    validationSplit: 0.20

  };


  /* =======================================================
     CEK TENSORFLOW
  ======================================================= */

  function requireTF() {

    if (
      typeof tf === "undefined"
    ) {

      throw new Error(
        "TensorFlow.js belum dimuat. " +
        "Tambahkan tensorflow.min.js pada lstm.html."
      );

    }

  }


  /* =======================================================
     AMBIL DATA FIREBASE
  ======================================================= */

  async function getFirebaseData(
    url = FIREBASE_HISTORY_URL
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
        "Data pada cuaca/history kosong."
      );

    }


    return data;

  }


  /* =======================================================
     OBJECT FIREBASE → ARRAY
  ======================================================= */

  function toArray(raw) {

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


  /* =======================================================
     ANGKA
  ======================================================= */

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


  /* =======================================================
     TIMESTAMP
  ======================================================= */

  function parseDatetime(row) {

    /*
      Prioritas timestamp Firebase
    */

    const timestamp =
      firstNumber(
        row,
        [
          "timestamp",
          "Timestamp"
        ]
      );


    if (
      timestamp !== null
    ) {

      const milliseconds =

        timestamp < 100000000000

          ? timestamp * 1000

          : timestamp;


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


    /*
      Jika ada Datetime
    */

    const datetime =
      row.Datetime ??
      row.datetime ??
      row.date_time;


    if (
      datetime
    ) {

      const date =
        new Date(
          datetime
        );


      if (
        !Number.isNaN(
          date.getTime()
        )
      ) {

        return date;

      }

    }


    /*
      Jika Firebase menggunakan
      tanggal + waktu
    */

    if (
      row.tanggal &&
      row.waktu
    ) {

      let dateString =

        String(
          row.tanggal
        ) +
        " " +
        String(
          row.waktu
        );


      /*
        Format Indonesia:
        DD/MM/YYYY
      */

      const match =
        dateString.match(
          /^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})\s*(.*)$/
        );


      if (
        match
      ) {

        const day =
          Number(
            match[1]
          );


        const month =
          Number(
            match[2]
          ) - 1;


        const year =
          Number(
            match[3]
          );


        const time =
          match[4] ||
          "00:00:00";


        const date =
          new Date(

            year,

            month,

            day

          );


        const timeParts =
          time.split(":");


        date.setHours(
          Number(
            timeParts[0]
          ) || 0,
          Number(
            timeParts[1]
          ) || 0,
          Number(
            timeParts[2]
          ) || 0
        );


        if (
          !Number.isNaN(
            date.getTime()
          )
        ) {

          return date;

        }

      }


      /*
        Coba parsing langsung
      */

      const date =
        new Date(
          dateString
        );


      if (
        !Number.isNaN(
          date.getTime()
        )
      ) {

        return date;

      }

    }


    return null;

  }


  /* =======================================================
     NORMALISASI ARAH
  ======================================================= */

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


  /* =======================================================
     ARAH ANGIN
  ======================================================= */

  function directionFromRow(row) {

    /*
      Jika Firebase menyimpan angka
      langsung.
    */

    const numeric =
      firstNumber(
        row,
        [

          "arah_angin_derajat",

          "arah_derajat",

          "wind_direction",

          "direction_degree",

          "derajat"

        ]
      );


    if (
      numeric !== null
    ) {

      return normalizeDirection(
        numeric
      );

    }


    /*
      Coba field arah_angin.
    */

    const raw =
      row.arah_angin ??
      row.arah ??
      row.direction;


    /*
      Jika berupa angka.
    */

    if (
      raw !== undefined &&
      raw !== null &&
      raw !== ""
    ) {

      const numericRaw =
        Number(
          raw
        );


      if (
        Number.isFinite(
          numericRaw
        )
      ) {

        return normalizeDirection(
          numericRaw
        );

      }

    }


    /*
      Jika berupa teks.
    */

    const text =
      String(
        raw ?? ""
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


  /* =======================================================
     TINGGI MUKA AIR
  ======================================================= */

  function getWaterLevel(
    row,
    sensorHeight = 2.5
  ) {

    /*
      Jika Firebase sudah memiliki
      tinggi muka air.
    */

    let waterLevel =
      firstNumber(
        row,
        [

          "tinggi_muka_air",

          "tinggi_permukaan_laut",

          "tinggiAir",

          "tinggi_air",

          "sea_level",

          "water_level"

        ]
      );


    if (
      waterLevel !== null
    ) {

      return waterLevel;

    }


    /*
      Jika belum ada,
      hitung dari jarak sensor.
    */

    let distance =
      firstNumber(
        row,
        [

          "jarak_meter",

          "distance_meter",

          "jarak_m"

        ]
      );


    if (
      distance !== null
    ) {

      return Math.max(

        0,

        sensorHeight -
        distance

      );

    }


    /*
      Cek jarak cm.
    */

    let distanceCm =
      firstNumber(
        row,
        [

          "jarak_cm",

          "distance_cm"

        ]
      );


    if (
      distanceCm !== null
    ) {

      return Math.max(

        0,

        sensorHeight -
        distanceCm / 100

      );

    }


    /*
      Jika field "jarak"
      digunakan dalam meter.
    */

    let jarak =
      firstNumber(
        row,
        [
          "jarak"
        ]
      );


    if (
      jarak !== null
    ) {

      return Math.max(

        0,

        sensorHeight -
        jarak

      );

    }


    return null;

  }


  /* =======================================================
     KONVERSI FIREBASE
  ======================================================= */

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


      /*
        SUHU
      */

      const suhu =
        firstNumber(
          row,
          [
            "suhu",
            "temperature",
            "temp"
          ]
        );


      /*
        KELEMBAPAN
      */

      const kelembapan =
        firstNumber(
          row,
          [
            "kelembapan",
            "humidity",
            "hum"
          ]
        );


      /*
        KECEPATAN ANGIN
      */

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


      /*
        ARAH ANGIN
      */

      const arah =
        directionFromRow(
          row
        );


      /*
        TINGGI MUKA AIR
      */

      const tinggiAir =
        getWaterLevel(
          row,
          sensorHeight
        );


      /*
        DATA TIDAK LENGKAP
        DILEWATI
      */

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


    /*
      Lama → baru
    */

    result.sort(

      (a, b) =>

        a.datetime -
        b.datetime

    );


    return result;

  }


  /* =======================================================
     BULATKAN WAKTU KE JAM
  ======================================================= */

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


  /* =======================================================
     DATA PER JAM
  ======================================================= */

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


      /*
        Jika ada beberapa data
        dalam satu jam,
        gunakan data terakhir.
      */

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

    ].sort(

      (a, b) =>

        a.datetime -
        b.datetime

    );

  }


  /* =======================================================
     MIN MAX SCALER
  ======================================================= */

  class MinMaxScaler {

    constructor() {

      this.min = [];

      this.max = [];

    }


    fit(matrix) {

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


    transform(matrix) {

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


    inverse(matrix) {

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


  /* =======================================================
     ROW → FEATURES
  ======================================================= */

  function rowToFeatures(row) {

    return [

      row.suhu,

      row.kelembapan,

      row.kecepatan_angin,

      row.arah_sin,

      row.arah_cos,

      row.tinggi_muka_air

    ];

  }


  /* =======================================================
     SEQUENCE
  ======================================================= */

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

          i -
          lookback,

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


  /* =======================================================
     MODEL LSTM
  ======================================================= */

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
        [
          "mae"
        ]

    });


    return model;

  }


  /* =======================================================
     METRIK REGRESI
  ======================================================= */

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

      let absolute = 0;

      let square = 0;

      let sum = 0;


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
          error *
          error;


        sum +=
          actual[i][j];

      }


      const mean =
        sum / n;


      let total = 0;

      let residual = 0;


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

          :

          1 -
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


  /* =======================================================
     ERROR ARAH ANGIN
  ======================================================= */

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

      let a =

        Math.atan2(

          actual[i][3],

          actual[i][4]

        ) *
        180 /
        Math.PI;


      let p =

        Math.atan2(

          predicted[i][3],

          predicted[i][4]

        ) *
        180 /
        Math.PI;


      a =
        (
          a +
          360
        ) % 360;


      p =
        (
          p +
          360
        ) % 360;


      actualDeg.push(a);

      predictedDeg.push(p);

    }


    let absolute = 0;

    let square = 0;


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


  /* =======================================================
     TRAINING
  ======================================================= */

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
      !Array.isArray(data)
    ) {

      throw new Error(
        "Data LSTM harus berupa array."
      );

    }


    if (
      data.length <=
      config.lookback + 10
    ) {

      throw new Error(

        "Jumlah data tidak cukup. " +

        "Minimal diperlukan lebih dari " +

        (
          config.lookback +
          10
        ) +

        " data per jam."

      );

    }


    const matrix =
      data.map(
        rowToFeatures
      );


    /*
      80% training
      20% testing
    */

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


    /*
      SCALER HANYA
      DARI TRAINING
    */

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


    /*
      SEQUENCE
    */

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


    if (
      trainSequence.X.length === 0
    ) {

      throw new Error(
        "Sequence training tidak terbentuk."
      );

    }


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


    /*
      TESTING
    */

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


    /*
      Bersihkan tensor
    */

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


  /* =======================================================
     FORECAST 7 HARI
  ======================================================= */

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


    /*
      Ambil 24 jam terakhir
    */

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

        "Data terakhir harus " +
        "minimal 24 jam."

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


    /*
      FORECAST REKURSIF
    */

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


      /*
        Konversi sin/cos
        kembali menjadi derajat.
      */

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


  /* =======================================================
     FORMAT DATETIME
  ======================================================= */

  function formatDatetime(
    date
  ) {

    const tahun =
      date.getFullYear();


    const bulan =
      String(
        date.getMonth() + 1
      )
      .padStart(
        2,
        "0"
      );


    const hari =
      String(
        date.getDate()
      )
      .padStart(
        2,
        "0"
      );


    const jam =
      String(
        date.getHours()
      )
      .padStart(
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


  /* =======================================================
     CSV
  ======================================================= */

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


  /* =======================================================
     INFO DATA
  ======================================================= */

  function getDataInfo(
    raw,
    hourly
  ) {

    return {

      firebaseRecords:
        toArray(raw).length,

      validRecords:
        hourly.length,

      firstDatetime:
        hourly.length
          ? hourly[0].datetime
          : null,

      lastDatetime:
        hourly.length
          ? hourly[
              hourly.length - 1
            ].datetime
          : null

    };

  }


  /* =======================================================
     PUBLIC API
  ======================================================= */

  window.LSTM = {

    FEATURES,

    DEFAULT,

    FIREBASE_HISTORY_URL,

    getFirebaseData,

    convertFirebaseData,

    prepareHourlyData,

    getDataInfo,

    train,

    forecast,

    toCSV,

    formatDatetime

  };


})();
