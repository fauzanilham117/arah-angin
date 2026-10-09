/**
 * Module Prediksi LSTM Monitoring Pesisir & Cuaca
 * Disesuaikan khusus untuk Realtime Database Firebase (kecepatan_ms, jarak_cm, kelembapan, dll)
 */

const LSTMPredictor = (function () {
  const MODEL_SAVE_PATH = 'localstorage://lstm-coastal-model-v3';

  // 1. Konversi Teks Arah Angin ke Derajat (0° - 360°)
  function parseWindDir(dir) {
    if (typeof dir === 'number') return dir;
    if (typeof dir === 'string') {
      const d = dir.toLowerCase().trim();
      if (d.includes('utara')) return 0;
      if (d.includes('timur laut')) return 45;
      if (d.includes('timur')) return 90;
      if (d.includes('tenggara')) return 135;
      if (d.includes('selatan')) return 180;
      if (d.includes('barat daya')) return 225;
      if (d.includes('barat laut')) return 315;
      if (d.includes('barat')) return 270;
    }
    return 0;
  }

  // 2. Ekstraksi dan Pembersihan Data Sesuai Key Firebase
  function processFirebaseData(rawData) {
    let rawList = Array.isArray(rawData) ? rawData : Object.values(rawData);
    let cleanList = rawList.filter(d => d && typeof d === 'object');

    // Filter Rentang 24 Jam Hari Kemarin (H-1)
    const now = new Date();
    const yesterdayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1, 0, 0, 0).getTime();
    const yesterdayEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1, 23, 59, 59).getTime();

    let filteredYesterday = cleanList.filter(item => {
      let ts = null;
      if (item.timestamp) {
        ts = new Date(item.timestamp).getTime();
      } else if (item.tanggal && item.waktu) {
        // Parsing format DD/MM/YYYY HH:mm:ss
        const parts = item.tanggal.split('/');
        if (parts.length === 3) {
          ts = new Date(`${parts[2]}-${parts[1]}-${parts[0]}T${item.waktu}`).getTime();
        }
      }
      return ts && ts >= yesterdayStart && ts <= yesterdayEnd;
    });

    // Fallback jika timestamp kosong atau data hari kemarin tidak cukup
    if (filteredYesterday.length < 10) {
      filteredYesterday = cleanList.slice(-79);
    }

    return filteredYesterday.map((item, index) => {
      // Tinggi Air Laut (jarak_cm dikonversi ke meter)
      let w = Number(item.jarak_cm ?? item.water_level ?? item.tinggi_muka_air ?? 0);
      if (item.jarak_cm !== undefined) {
        w = w / 100; // Contoh: 57.4 cm -> 0.574 m
      }

      // Kecepatan Angin (m/s)
      const ws = Number(item.kecepatan_ms ?? item.wind_speed ?? item.kecepatan_angin ?? 0);

      // Suhu, Kelembapan, Tekanan
      const t = Number(item.suhu ?? item.temp ?? 0);
      const h = Number(item.kelembapan ?? item.kelembaban ?? item.humidity ?? 0);
      const p = Number(item.tekanan ?? item.pressure ?? 1013.25);

      // Arah Angin
      const deg = parseWindDir(item.arah_angin ?? item.wind_dir ?? 0);

      // Label Waktu Grafik
      let timeLabel = item.waktu ?? (item.timestamp ? item.timestamp.split(' ')[1] : `T-${filteredYesterday.length - index}`);

      const rad = (deg * Math.PI) / 180;
      return {
        label: timeLabel,
        water_level: Number(w.toFixed(2)),
        temp: t,
        humidity: h,
        pressure: p,
        wind_speed: ws,
        wind_u: Math.sin(rad),
        wind_v: Math.cos(rad),
        wind_dir: deg
      };
    });
  }

  // 3. Safe Min-Max Normalization (Mencegah NaN / Pembagian Nol)
  function normalizeFeatures(features, numFeatures) {
    const mins = Array(numFeatures).fill(Infinity);
    const maxs = Array(numFeatures).fill(-Infinity);

    for (let i = 0; i < features.length; i++) {
      for (let j = 0; j < numFeatures; j++) {
        if (features[i][j] < mins[j]) mins[j] = features[i][j];
        if (features[i][j] > maxs[j]) maxs[j] = features[i][j];
      }
    }

    const scaledFeatures = features.map(row =>
      row.map((val, col) => {
        const range = maxs[col] - mins[col];
        return range === 0 ? 0.5 : (val - mins[col]) / range;
      })
    );

    return { scaledFeatures, mins, maxs };
  }

  // 4. Perhitungan Metrik Evaluasi (RMSE, MAE, R, R2)
  function calculateMetrics(yTrue, yPred) {
    const n = yTrue.length;
    if (n === 0) return { rmse: 0, mae: 0, r: 0, r2: 0 };

    let sumErr2 = 0, sumAbsErr = 0, sumTrue = 0, sumPred = 0;
    for (let i = 0; i < n; i++) {
      const err = yTrue[i] - yPred[i];
      sumErr2 += err * err;
      sumAbsErr += Math.abs(err);
      sumTrue += yTrue[i];
      sumPred += yPred[i];
    }

    const meanTrue = sumTrue / n;
    const meanPred = sumPred / n;
    let numR = 0, denTrueR = 0, denPredR = 0, ssTot = 0;

    for (let i = 0; i < n; i++) {
      const diffTrue = yTrue[i] - meanTrue;
      const diffPred = yPred[i] - meanPred;
      numR += diffTrue * diffPred;
      denTrueR += diffTrue * diffTrue;
      denPredR += diffPred * diffPred;
      ssTot += diffTrue * diffTrue;
    }

    const rmse = Math.sqrt(sumErr2 / n);
    const mae = sumAbsErr / n;
    const denR = Math.sqrt(denTrueR) * Math.sqrt(denPredR);
    const r = denR === 0 ? 0 : numR / denR;
    const r2 = ssTot === 0 ? 0 : 1 - (sumErr2 / ssTot);

    return { rmse, mae, r, r2 };
  }

  // 5. Fungsi Utama Pelatihan & Prediksi
  async function run(rawData, lookback = 5, forecastSteps = 12, onProgress = null) {
    const dataset = processFirebaseData(rawData);
    if (dataset.length < lookback + 1) {
      throw new Error(`Data histori tidak mencukupi (diperlukan minimal ${lookback + 1} sampel data).`);
    }

    const features = dataset.map(d => [
      d.water_level, d.temp, d.humidity, d.pressure, d.wind_speed, d.wind_u, d.wind_v
    ]);

    const numFeatures = 7;
    const { scaledFeatures, mins, maxs } = normalizeFeatures(features, numFeatures);

    const X_train = [], Y_train = [];
    for (let i = 0; i <= scaledFeatures.length - lookback - 1; i++) {
      X_train.push(scaledFeatures.slice(i, i + lookback));
      Y_train.push(scaledFeatures[i + lookback]);
    }

    const xs = tf.tensor3d(X_train);
    const ys = tf.tensor2d(Y_train);

    tf.setBackend('cpu'); // Eksekusi konsisten di CPU
    const model = tf.sequential();
    model.add(tf.layers.lstm({
      units: 16,
      inputShape: [lookback, numFeatures],
      returnSequences: false,
      kernelInitializer: 'glorotUniform'
    }));
    model.add(tf.layers.dense({ units: numFeatures, kernelInitializer: 'glorotUniform' }));
    model.compile({ optimizer: tf.train.adam(0.001), loss: 'meanSquaredError' });

    const epochs = 40;
    await model.fit(xs, ys, {
      epochs: epochs,
      batchSize: 8,
      shuffle: false,
      callbacks: {
        onEpochEnd: (epoch, logs) => {
          if (onProgress) onProgress(epoch + 1, epochs, logs.loss || 0);
        }
      }
    });

    // Evaluasi Histori (Aktual vs Prediksi Sekuensial)
    const trainPredTensor = model.predict(xs);
    const trainPredArray = await trainPredTensor.array();
    trainPredTensor.dispose();

    const historicalPredictions = trainPredArray.map(row => {
      const real = row.map((val, col) => {
        const range = maxs[col] - mins[col];
        return range === 0 ? mins[col] : val * range + mins[col];
      });
      let deg = (Math.atan2(real[5], real[6]) * 180) / Math.PI;
      if (deg < 0) deg += 360;
      return [real[0], real[1], real[2], real[3], real[4], deg];
    });

    // Hitung Metrik Akurasi
    const yTrueOriginal = Y_train.map(row => {
      const real = row.map((val, col) => {
        const range = maxs[col] - mins[col];
        return range === 0 ? mins[col] : val * range + mins[col];
      });
      let deg = (Math.atan2(real[5], real[6]) * 180) / Math.PI;
      if (deg < 0) deg += 360;
      return [real[0], real[1], real[2], real[3], real[4], deg];
    });

    const paramNames = ["Tinggi Air Laut (m)", "Suhu Udara (°C)", "Kelembaban (%)", "Tekanan (hPa)", "Kecepatan Angin (m/s)", "Arah Angin (°)"];
    const metricsResults = [];
    for (let p = 0; p < 6; p++) {
      const actuals = yTrueOriginal.map(row => row[p]);
      const preds = historicalPredictions.map(row => row[p]);
      const m = calculateMetrics(actuals, preds);
      metricsResults.push({ name: paramNames[p], ...m });
    }

    // Prediksi Langkah Masa Depan (Forecast)
    let currentSeq = scaledFeatures.slice(-lookback);
    let scaledPreds = [];

    for (let s = 0; s < forecastSteps; s++) {
      const inputTensor = tf.tensor3d([currentSeq]);
      const predTensor = model.predict(inputTensor);
      const predArray = (await predTensor.array())[0];

      scaledPreds.push(predArray);
      currentSeq.shift();
      currentSeq.push(predArray);

      inputTensor.dispose();
      predTensor.dispose();
    }

    const futurePredictions = scaledPreds.map(row => {
      const real = row.map((val, col) => {
        const range = maxs[col] - mins[col];
        return range === 0 ? mins[col] : val * range + mins[col];
      });

      let deg = (Math.atan2(real[5], real[6]) * 180) / Math.PI;
      if (deg < 0) deg += 360;

      return {
        water_level: Number(real[0].toFixed(2)),
        temp: Number(real[1].toFixed(1)),
        humidity: Number(real[2].toFixed(1)),
        pressure: Number(real[3].toFixed(1)),
        wind_speed: Number(real[4].toFixed(1)),
        wind_dir: Number(deg.toFixed(0))
      };
    });

    xs.dispose(); ys.dispose(); model.dispose();

    return {
      lookback: lookback,
      historical: dataset,
      historicalPredictions: historicalPredictions,
      predictions: futurePredictions,
      metrics: metricsResults
    };
  }

  return { run };
})();
