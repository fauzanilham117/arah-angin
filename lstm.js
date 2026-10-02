/* =========================================================
   LSTM.JS
   Prediksi Deret Waktu menggunakan TensorFlow.js
   
   Fitur Input:
   1. Suhu (°C)
   2. Kelembaban (%)
   3. Kecepatan Angin (m/s)
   4. Arah Angin Sin (Trigonometri)
   5. Arah Angin Cos (Trigonometri)
   6. Tinggi Muka Air Laut (m)
   ========================================================= */

(function () {
  "use strict";

  // Fitur yang digunakan untuk pelatihan model
  const FEATURES = [
    "suhu",
    "kelembapan",
    "kecepatan_angin",
    "arah_sin",
    "arah_cos",
    "tinggi_muka_air"
  ];

  // Min-Max Scaler untuk normalisasi [0, 1]
  function calculateScalers(data) {
    const scalers = {};
    FEATURES.forEach(feature => {
      const values = data.map(d => d[feature]);
      const min = Math.min(...values);
      const max = Math.max(...values);
      scalers[feature] = {
        min: min,
        max: max === min ? min + 1 : max
      };
    });
    return scalers;
  }

  function scaleValue(val, min, max) {
    return (val - min) / (max - min);
  }

  function unscaleValue(val, min, max) {
    return val * (max - min) + min;
  }

  // Buat pasangan sequence input-output (Lookback)
  function createSequences(normalizedData, lookback) {
    const X = [];
    const y = [];

    for (let i = 0; i <= normalizedData.length - lookback - 1; i++) {
      const window = normalizedData.slice(i, i + lookback);
      const nextStep = normalizedData[i + lookback];

      X.push(window.map(row => FEATURES.map(f => row[f])));
      y.push(FEATURES.map(f => nextStep[f]));
    }

    return { X, y };
  }

  // Bangun arsitektur model LSTM
  function buildLSTMModel(lookback, numFeatures) {
    const model = tf.sequential();

    // Layer LSTM Pertama
    model.add(tf.layers.lstm({
      units: 32,
      returnSequences: false,
      inputShape: [lookback, numFeatures]
    }));

    model.add(tf.layers.dropout({ rate: 0.1 }));

    // Layer Dense
    model.add(tf.layers.dense({ units: 16, activation: 'relu' }));
    
    // Output Layer (Multi-output regression)
    model.add(tf.layers.dense({ units: numFeatures, activation: 'linear' }));

    model.compile({
      optimizer: tf.train.adam(0.005),
      loss: 'meanSquaredError'
    });

    return model;
  }

  // Fungsi Utama Pemrosesan & Prediksi
  async function runLSTMPrediction(rawFirebaseData, lookbackHours = 24, forecastSteps = 12, onEpochEndCallback) {
    if (typeof tf === "undefined") {
      throw new Error("TensorFlow.js tidak terdeteksi. Silakan muat pustaka TensorFlow.js terlebih dahulu.");
    }

    // 1. Ekstrak & bersihkan data
    const cleanedData = [];
    for (const key in rawFirebaseData) {
      const item = rawFirebaseData[key];
      if (!item) continue;

      const suhu = Number(item.suhu ?? item.temperature ?? 0);
      const kelembapan = Number(item.kelembapan ?? item.humidity ?? 0);
      const kecepatan = Number(item.kecepatan_ms ?? item.kecepatan_angin ?? 0);
      const arahDeg = Number(item.arah_angin ?? item.arah ?? 0);
      
      let tinggiAir = Number(item.tinggi_muka_air ?? item.waterLevel ?? 0);
      if (!tinggiAir && item.jarak_meter !== undefined) {
        tinggiAir = Math.max(0, 2.5 - Number(item.jarak_meter));
      }

      const rad = (arahDeg * Math.PI) / 180;

      cleanedData.push({
        timestamp: item.timestamp || Date.now(),
        suhu,
        kelembapan,
        kecepatan_angin: kecepatan,
        arah_sin: Math.sin(rad),
        arah_cos: Math.cos(rad),
        tinggi_muka_air: tinggiAir
      });
    }

    if (cleanedData.length < lookbackHours + 5) {
      throw new Error(`Data histori tidak cukup (${cleanedData.length} sampel). Minimal butuh ${lookbackHours + 5} sampel data.`);
    }

    // Sort berdasarkan timestamp
    cleanedData.sort((a, b) => a.timestamp - b.timestamp);

    // 2. Normalisasi Data
    const scalers = calculateScalers(cleanedData);
    const normalizedData = cleanedData.map(d => {
      const normObj = {};
      FEATURES.forEach(f => {
        normObj[f] = scaleValue(d[f], scalers[f].min, scalers[f].max);
      });
      return normObj;
    });

    // 3. Persiapan Dataset Tensor
    const { X, y } = createSequences(normalizedData, lookbackHours);
    const xsTensor = tf.tensor3d(X);
    const ysTensor = tf.tensor2d(y);

    // 4. Latih Model
    const model = buildLSTMModel(lookbackHours, FEATURES.length);
    
    await model.fit(xsTensor, ysTensor, {
      epochs: 30,
      batchSize: 16,
      validationSplit: 0.1,
      callbacks: {
        onEpochEnd: (epoch, logs) => {
          if (onEpochEndCallback) {
            onEpochEndCallback(epoch + 1, 30, logs.loss);
          }
        }
      }
    });

    // Clean memory tensor dataset
    xsTensor.dispose();
    ysTensor.dispose();

    // 5. Prediksi Masa Depan (Iterative Autoregressive Multi-step Forecast)
    let currentInputWindow = normalizedData.slice(-lookbackHours).map(row => FEATURES.map(f => row[f]));
    const predictionsNormalized = [];

    for (let step = 0; step < forecastSteps; step++) {
      const inputTensor = tf.tensor3d([currentInputWindow]);
      const predTensor = model.predict(inputTensor);
      const predArray = (await predTensor.array())[0];

      predictionsNormalized.push(predArray);

      // Geser window input (remove oldest, append prediction)
      currentInputWindow.shift();
      currentInputWindow.push(predArray);

      inputTensor.dispose();
      predTensor.dispose();
    }

    // 6. Denormalisasi Hasil Prediksi
    const lastTimestamp = cleanedData[cleanedData.length - 1].timestamp;
    const timeInterval = 3600 * 1000; // Asumsi interval 1 jam

    const predictionsFormatted = predictionsNormalized.map((predArr, idx) => {
      const res = {
        timestamp: lastTimestamp + (idx + 1) * timeInterval
      };

      FEATURES.forEach((f, i) => {
        res[f] = unscaleValue(predArr[i], scalers[f].min, scalers[f].max);
      });

      // Rekonstruksi derajat arah angin dari sin & cos
      const deg = (Math.atan2(res.arah_sin, res.arah_cos) * 180) / Math.PI;
      res.arah_angin = (deg + 360) % 360;

      return res;
    });

    model.dispose();

    return {
      historical: cleanedData,
      predictions: predictionsFormatted
    };
  }

  // Export fungsi ke global namespace Window
  window.LSTMPredictor = {
    run: runLSTMPrediction
  };

})();
