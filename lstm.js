// ============================================================
// LSTM FORECAST - MONITORING PESISIR
// Sumber data : Firebase Realtime Database /cuaca/history
// Parameter   :
// 1. Suhu
// 2. Kelembapan
// 3. Tekanan udara
// 4. Tinggi muka air
// 5. Kecepatan angin
// Forecast    : 168 langkah
// ============================================================

import {
  initializeApp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";

import {
  getDatabase,
  ref,
  get
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";

// ============================================================
// CEK TENSORFLOW
// ============================================================

if (typeof tf === "undefined") {
  throw new Error(
    "TensorFlow.js belum dimuat. Pastikan tf.min.js dipanggil sebelum lstm.js."
  );
}

// ============================================================
// KONFIGURASI FIREBASE
// ============================================================
//
// MASUKKAN KONFIGURASI FIREBASE YANG SAMA DENGAN index.html
//
// Contoh:
// ============================================================

const firebaseConfig = {
  apiKey: "AIzaSyCt2pkxO6vYpDXFHNqbFWmlMmS2JLlSjA0",
  authDomain: "arah-angin-76f91.firebaseapp.com",
  databaseURL: "https://arah-angin-76f91-default-rtdb.firebaseio.com",
  projectId: "arah-angin-76f91",
  storageBucket: "arah-angin-76f91.firebasestorage.app",
  messagingSenderId: "937712967453",
  appId: "1:937712967453:web:36e81a289fe2a33b694bf4"
};

// ============================================================
// INISIALISASI FIREBASE
// ============================================================

const app = initializeApp(firebaseConfig);
const db = getDatabase(app);

// ============================================================
// KONFIGURASI LSTM
// ============================================================

const FIREBASE_PATH = "cuaca/history";

// Jumlah data yang digunakan untuk membaca pola sebelumnya.
// 24 = 24 titik data terakhir untuk memprediksi titik berikutnya.
const LOOKBACK = 24;

// Jumlah langkah forecast
const FORECAST_STEPS = 168;

// Jumlah epoch
const EPOCHS = 50;

// Batch size
const BATCH_SIZE = 16;

// Learning rate
const LEARNING_RATE = 0.001;

// Tinggi sensor dari referensi permukaan air.
// Digunakan jika database hanya menyimpan jarak sensor.
const SENSOR_HEIGHT = 2.5;

// ============================================================
// PARAMETER YANG AKAN DIPREDIKSI
// ============================================================

const PARAMETERS = {
  suhu: {
    name: "Suhu",
    unit: "°C",
    keys: ["suhu"]
  },

  kelembapan: {
    name: "Kelembapan",
    unit: "%",
    keys: ["kelembapan", "humidity"]
  },

  tekanan: {
    name: "Tekanan Udara",
    unit: "hPa",
    keys: ["tekanan", "tekanan_udara", "pressure"]
  },

  tinggiAir: {
    name: "Tinggi Muka Air",
    unit: "m",
    keys: [
      "tinggiAir",
      "tinggi_air",
      "tinggi_permukaan_laut",
      "tinggi_permukaan_air",
      "tinggi_muka_air"
    ]
  },

  kecepatan_ms: {
    name: "Kecepatan Angin",
    unit: "m/s",
    keys: [
      "kecepatan_ms",
      "kecepatan_angin",
      "wind_speed"
    ]
  }
};

// ============================================================
// VARIABEL GLOBAL
// ============================================================

let firebaseData = [];
let forecastResults = {};

let chartInstances = {};


// ============================================================
// FUNGSI LOG
// ============================================================

function log(message) {
  const waktu = new Date().toLocaleTimeString("id-ID");

  console.log(`[${waktu}] ${message}`);

  const logElement = document.getElementById("log");

  if (logElement) {
    logElement.innerHTML +=
      `[${waktu}] ${message}<br>`;

    logElement.scrollTop = logElement.scrollHeight;
  }
}


// ============================================================
// FORMAT ANGKA
// ============================================================

function formatNumber(value, decimal = 2) {

  if (value === null || value === undefined) {
    return "-";
  }

  const number = Number(value);

  if (!Number.isFinite(number)) {
    return "-";
  }

  return number.toFixed(decimal);
}


// ============================================================
// MENCARI NILAI PARAMETER
// ============================================================

function getParameterValue(data, parameter) {

  if (!data || typeof data !== "object") {
    return null;
  }

  // ----------------------------------------------------------
  // TINGGI MUKA AIR
  // ----------------------------------------------------------

  if (parameter === "tinggiAir") {

    // Coba cari tinggi air secara langsung
    const directKeys = PARAMETERS.tinggiAir.keys;

    for (const key of directKeys) {

      if (
        data[key] !== undefined &&
        data[key] !== null &&
        data[key] !== ""
      ) {

        const value = Number(data[key]);

        if (Number.isFinite(value)) {
          return value;
        }
      }
    }

    // --------------------------------------------------------
    // Jika tidak ada tinggi air,
    // coba hitung dari jarak sensor
    // --------------------------------------------------------

    if (
      data.jarak_meter !== undefined &&
      data.jarak_meter !== null
    ) {

      const jarak = Number(data.jarak_meter);

      if (Number.isFinite(jarak)) {

        return Math.max(
          0,
          SENSOR_HEIGHT - jarak
        );
      }
    }

    if (
      data.jarak_cm !== undefined &&
      data.jarak_cm !== null
    ) {

      const jarakMeter =
        Number(data.jarak_cm) / 100;

      if (Number.isFinite(jarakMeter)) {

        return Math.max(
          0,
          SENSOR_HEIGHT - jarakMeter
        );
      }
    }

    return null;
  }

  // ----------------------------------------------------------
  // PARAMETER LAIN
  // ----------------------------------------------------------

  const keys =
    PARAMETERS[parameter]?.keys || [];

  for (const key of keys) {

    if (
      data[key] !== undefined &&
      data[key] !== null &&
      data[key] !== ""
    ) {

      const value = Number(data[key]);

      if (Number.isFinite(value)) {
        return value;
      }
    }
  }

  return null;
}


// ============================================================
// MENCARI TIMESTAMP
// ============================================================

function getTimestamp(item) {

  if (!item || typeof item !== "object") {
    return null;
  }

  const kemungkinan = [
    item.timestamp,
    item.time,
    item.waktu,
    item.datetime,
    item.date_time,
    item.tanggal,
    item.createdAt,
    item.created_at
  ];

  for (const value of kemungkinan) {

    if (
      value !== undefined &&
      value !== null &&
      value !== ""
    ) {

      // Angka timestamp
      if (typeof value === "number") {

        const date =
          value < 10000000000
            ? new Date(value * 1000)
            : new Date(value);

        if (!isNaN(date.getTime())) {
          return date.getTime();
        }
      }

      // String tanggal
      const date =
        new Date(value);

      if (!isNaN(date.getTime())) {
        return date.getTime();
      }
    }
  }

  return null;
}


// ============================================================
// MEMBACA DATA FIREBASE
// ============================================================

async function loadFirebaseData() {

  log("Mulai membaca Firebase...");

  try {

    const historyRef =
      ref(db, FIREBASE_PATH);

    const snapshot =
      await get(historyRef);

    if (!snapshot.exists()) {

      throw new Error(
        "Data cuaca/history tidak ditemukan."
      );
    }

    const rawData =
      snapshot.val();

    const hasil = [];

    // --------------------------------------------------------
    // Jika Firebase berbentuk object
    // --------------------------------------------------------

    if (
      rawData &&
      typeof rawData === "object"
    ) {

      Object.entries(rawData)
        .forEach(([key, value]) => {

          if (
            value &&
            typeof value === "object"
          ) {

            hasil.push({
              ...value,
              firebaseKey: key
            });

          }

        });

    }

    // --------------------------------------------------------
    // Urutkan berdasarkan timestamp jika tersedia
    // --------------------------------------------------------

    const memilikiTimestamp =
      hasil.some(
        item => getTimestamp(item) !== null
      );

    if (memilikiTimestamp) {

      hasil.sort((a, b) => {

        const ta = getTimestamp(a);
        const tb = getTimestamp(b);

        if (ta === null) return 1;
        if (tb === null) return -1;

        return ta - tb;
      });

      log(
        "Data diurutkan berdasarkan waktu."
      );

    } else {

      log(
        "Timestamp tidak ditemukan. Urutan Firebase digunakan."
      );
    }

    firebaseData = hasil;

    log(
      `Data Firebase berhasil diterima: ${firebaseData.length} data.`
    );

    return firebaseData;

  } catch (error) {

    console.error(error);

    log(
      "Gagal membaca Firebase: " +
      error.message
    );

    throw error;
  }
}


// ============================================================
// MENGAMBIL DATA SATU PARAMETER
// ============================================================

function extractParameterData(parameter) {

  const config =
    PARAMETERS[parameter];

  const result = [];

  for (const item of firebaseData) {

    const value =
      getParameterValue(
        item,
        parameter
      );

    if (
      value === null ||
      !Number.isFinite(value)
    ) {
      continue;
    }

    result.push({
      value: value,
      timestamp: getTimestamp(item)
    });
  }

  return result;
}


// ============================================================
// NORMALISASI MIN-MAX
// ============================================================

function normalizeData(values) {

  const min =
    Math.min(...values);

  const max =
    Math.max(...values);

  // Jika seluruh nilai sama
  if (max === min) {

    return {
      normalized: values.map(() => 0.5),
      min,
      max
    };
  }

  const normalized =
    values.map(value =>
      (value - min) /
      (max - min)
    );

  return {
    normalized,
    min,
    max
  };
}


// ============================================================
// DENORMALISASI
// ============================================================

function denormalize(value, min, max) {

  if (max === min) {
    return min;
  }

  return (
    value * (max - min) + min
  );
}


// ============================================================
// MEMBUAT DATA TRAINING
// ============================================================

function createSequences(data) {

  const X = [];
  const y = [];

  for (
    let i = LOOKBACK;
    i < data.length;
    i++
  ) {

    const sequence =
      data.slice(
        i - LOOKBACK,
        i
      );

    X.push(
      sequence.map(value => [value])
    );

    y.push([data[i]]);
  }

  return {
    X,
    y
  };
}


// ============================================================
// MEMBUAT MODEL LSTM
// ============================================================

function createModel() {

  const model =
    tf.sequential();

  model.add(
    tf.layers.lstm({
      units: 32,
      inputShape: [LOOKBACK, 1],
      returnSequences: false
    })
  );

  model.add(
    tf.layers.dense({
      units: 16,
      activation: "relu"
    })
  );

  model.add(
    tf.layers.dense({
      units: 1
    })
  );

  model.compile({
    optimizer:
      tf.train.adam(
        LEARNING_RATE
      ),

    loss: "meanSquaredError"
  });

  return model;
}


// ============================================================
// MENGHITUNG INTERVAL DATA
// ============================================================

function calculateInterval(data) {

  const timestamps =
    data
      .map(item => item.timestamp)
      .filter(
        value =>
          value !== null &&
          Number.isFinite(value)
      );

  if (timestamps.length < 2) {
    return null;
  }

  const intervals = [];

  for (
    let i = 1;
    i < timestamps.length;
    i++
  ) {

    const diff =
      timestamps[i] -
      timestamps[i - 1];

    if (diff > 0) {
      intervals.push(diff);
    }
  }

  if (intervals.length === 0) {
    return null;
  }

  intervals.sort(
    (a, b) => a - b
  );

  const middle =
    Math.floor(
      intervals.length / 2
    );

  return intervals[middle];
}


// ============================================================
// FORMAT INTERVAL
// ============================================================

function formatInterval(milliseconds) {

  if (!milliseconds) {
    return "interval tidak diketahui";
  }

  const minutes =
    milliseconds / 60000;

  if (minutes < 60) {

    return `${formatNumber(minutes, 1)} menit`;
  }

  const hours =
    minutes / 60;

  if (hours < 24) {

    return `${formatNumber(hours, 1)} jam`;
  }

  const days =
    hours / 24;

  return `${formatNumber(days, 1)} hari`;
}


// ============================================================
// MEMBUAT LABEL WAKTU FORECAST
// ============================================================

function createForecastDates(
  sourceData,
  steps
) {

  const validTimestamps =
    sourceData
      .map(item => item.timestamp)
      .filter(
        value =>
          value !== null &&
          Number.isFinite(value)
      );

  if (
    validTimestamps.length === 0
  ) {

    return Array.from(
      { length: steps },
      (_, index) =>
        `Langkah ${index + 1}`
    );
  }

  const lastTimestamp =
    validTimestamps[
      validTimestamps.length - 1
    ];

  const interval =
    calculateInterval(sourceData);

  // Jika interval tidak diketahui,
  // gunakan label langkah.
  if (!interval) {

    return Array.from(
      { length: steps },
      (_, index) =>
        `Langkah ${index + 1}`
    );
  }

  const dates = [];

  for (
    let i = 1;
    i <= steps;
    i++
  ) {

    const timestamp =
      lastTimestamp +
      interval * i;

    const date =
      new Date(timestamp);

    dates.push(
      date.toLocaleString(
        "id-ID",
        {
          day: "2-digit",
          month: "2-digit",
          year: "numeric",
          hour: "2-digit",
          minute: "2-digit"
        }
      )
    );
  }

  return dates;
}


// ============================================================
// TRAINING DAN FORECAST SATU PARAMETER
// ============================================================

async function trainAndForecast(
  parameter
) {

  const config =
    PARAMETERS[parameter];

  log(
    `----------------------------------------`
  );

  log(
    `Memproses parameter: ${config.name}`
  );

  // ----------------------------------------------------------
  // Ambil data
  // ----------------------------------------------------------

  const parameterData =
    extractParameterData(
      parameter
    );

  log(
    `${config.name}: ${parameterData.length} data valid.`
  );

  // ----------------------------------------------------------
  // Cek jumlah data
  // ----------------------------------------------------------

  if (
    parameterData.length <= LOOKBACK
  ) {

    log(
      `PERINGATAN: data ${config.name} tidak cukup untuk training.`
    );

    return {
      parameter,
      name: config.name,
      unit: config.unit,
      status: "insufficient",
      values: [],
      dates: []
    };
  }

  // ----------------------------------------------------------
  // Ambil nilai
  // ----------------------------------------------------------

  const values =
    parameterData.map(
      item => item.value
    );

  // ----------------------------------------------------------
  // Normalisasi
  // ----------------------------------------------------------

  const normalized =
    normalizeData(values);

  const normalizedValues =
    normalized.normalized;

  // ----------------------------------------------------------
  // Buat sequence
  // ----------------------------------------------------------

  const sequences =
    createSequences(
      normalizedValues
    );

  log(
    `${config.name}: ${sequences.X.length} sequence training.`
  );

  // ----------------------------------------------------------
  // Tensor
  // ----------------------------------------------------------

  const X =
    tf.tensor3d(
      sequences.X
    );

  const y =
    tf.tensor2d(
      sequences.y
    );

  // ----------------------------------------------------------
  // Model
  // ----------------------------------------------------------

  const model =
    createModel();

  log(
    `Training LSTM ${config.name}...`
  );

  // ----------------------------------------------------------
  // Training
  // ----------------------------------------------------------

  try {

    await model.fit(
      X,
      y,
      {
        epochs: EPOCHS,
        batchSize: BATCH_SIZE,
        shuffle: false,

        callbacks: {

          onEpochEnd:
            async (epoch, logs) => {

              if (
                epoch === 0 ||
                (epoch + 1) % 10 === 0 ||
                epoch === EPOCHS - 1
              ) {

                log(
                  `${config.name} - Epoch ${epoch + 1}/${EPOCHS} - Loss: ${formatNumber(logs.loss, 6)}`
                );
              }

              // Memberi kesempatan browser
              // memperbarui tampilan.
              await tf.nextFrame();
            }
        }
      }
    );

  } catch (error) {

    X.dispose();
    y.dispose();
    model.dispose();

    throw error;
  }

  log(
    `Training ${config.name} selesai.`
  );

  // ----------------------------------------------------------
  // Forecast recursive
  // ----------------------------------------------------------

  let sequence =
    normalizedValues
      .slice(
        normalizedValues.length -
        LOOKBACK
      );

  const predictionsNormalized =
    [];

  for (
    let i = 0;
    i < FORECAST_STEPS;
    i++
  ) {

    const input =
      tf.tensor3d(
        [sequence.map(v => [v])]
      );

    const prediction =
      model.predict(input);

    const predictionArray =
      await prediction.data();

    const nextValue =
      Number(
        predictionArray[0]
      );

    predictionsNormalized.push(
      nextValue
    );

    // Masukkan hasil prediksi
    // ke sequence berikutnya.
    sequence =
      [
        ...sequence.slice(1),
        nextValue
      ];

    input.dispose();
    prediction.dispose();

    // Tidak perlu menghentikan proses
    // terlalu lama pada browser.
    if (
      i % 10 === 0
    ) {
      await tf.nextFrame();
    }
  }

  // ----------------------------------------------------------
  // Denormalisasi
  // ----------------------------------------------------------

  const predictions =
    predictionsNormalized.map(
      value =>
        denormalize(
          value,
          normalized.min,
          normalized.max
        )
    );

  // ----------------------------------------------------------
  // Batasi nilai tertentu
  // ----------------------------------------------------------

  let finalPredictions =
    predictions;

  // Kelembapan tidak boleh
  // keluar dari 0-100%.
  if (
    parameter === "kelembapan"
  ) {

    finalPredictions =
      predictions.map(
        value =>
          Math.max(
            0,
            Math.min(
              100,
              value
            )
          )
      );
  }

  // Tinggi air tidak boleh negatif
  if (
    parameter === "tinggiAir"
  ) {

    finalPredictions =
      predictions.map(
        value =>
          Math.max(
            0,
            value
          )
      );
  }

  // Kecepatan angin tidak boleh negatif
  if (
    parameter === "kecepatan_ms"
  ) {

    finalPredictions =
      predictions.map(
        value =>
          Math.max(
            0,
            value
          )
      );
  }

  // ----------------------------------------------------------
  // Label waktu
  // ----------------------------------------------------------

  const dates =
    createForecastDates(
      parameterData,
      FORECAST_STEPS
    );

  // ----------------------------------------------------------
  // Bersihkan Tensor
  // ----------------------------------------------------------

  X.dispose();
  y.dispose();
  model.dispose();

  // ----------------------------------------------------------
  // Hasil
  // ----------------------------------------------------------

  const result = {

    parameter,

    name: config.name,

    unit: config.unit,

    status: "success",

    historicalCount:
      values.length,

    trainingSequences:
      sequences.X.length,

    min:
      normalized.min,

    max:
      normalized.max,

    historical:
      values,

    forecast:
      finalPredictions,

    dates
  };

  log(
    `Forecast ${config.name}: ${FORECAST_STEPS} langkah berhasil.`
  );

  return result;
}


// ============================================================
// MEMBUAT CONTAINER HASIL JIKA BELUM ADA
// ============================================================

function createResultContainers() {

  const container =
    document.getElementById(
      "forecastContainer"
    );

  if (!container) {
    return;
  }

  container.innerHTML = "";

  Object.entries(PARAMETERS)
    .forEach(
      ([key, config]) => {

        const card =
          document.createElement(
            "div"
          );

        card.className =
          "forecast-card";

        card.innerHTML = `

          <div class="forecast-header">

            <h3>
              ${config.name}
            </h3>

            <span>
              ${config.unit}
            </span>

          </div>

          <div
            id="status-${key}"
            class="forecast-status"
          >
            Menunggu proses...
          </div>

          <div
            class="chart-wrapper"
          >
            <canvas
              id="chart-${key}"
            ></canvas>
          </div>

          <div
            id="summary-${key}"
            class="forecast-summary"
          >
          </div>

          <div
            class="table-wrapper"
          >

            <table
              id="table-${key}"
            >

              <thead>

                <tr>

                  <th>
                    Langkah
                  </th>

                  <th>
                    Waktu
                  </th>

                  <th>
                    Prediksi
                  </th>

                </tr>

              </thead>

              <tbody>
              </tbody>

            </table>

          </div>

        `;

        container.appendChild(
          card
        );

      }
    );
}


// ============================================================
// MEMBUAT GRAFIK
// ============================================================

function createChart(
  parameter,
  result
) {

  if (
    typeof Chart === "undefined"
  ) {

    log(
      "Chart.js belum dimuat."
    );

    return;
  }

  const canvas =
    document.getElementById(
      `chart-${parameter}`
    );

  if (!canvas) {
    return;
  }

  // Hapus chart lama
  if (
    chartInstances[parameter]
  ) {

    chartInstances[
      parameter
    ].destroy();
  }

  // Ambil data historis terakhir
  // supaya grafik tidak terlalu panjang.
  const historical =
    result.historical;

  const displayHistorical =
    historical.slice(-100);

  const historicalLabels =
    displayHistorical.map(
      (_, index) =>
        `H-${displayHistorical.length - index}`
    );

  const forecastLabels =
    result.dates.map(
      (_, index) =>
        `F+${index + 1}`
    );

  const labels = [
    ...historicalLabels,
    ...forecastLabels
  ];

  const historicalData =
    [
      ...Array(
        historicalLabels.length
      ).fill(null),

      ...result.forecast
    ];

  // Data historis dibuat terpisah
  // untuk menjaga grafik tetap jelas.
  const actualData =
    [
      ...displayHistorical,
      ...Array(
        result.forecast.length
      ).fill(null)
    ];

  const forecastData =
    [
      ...Array(
        displayHistorical.length - 1
      ).fill(null),

      displayHistorical[
        displayHistorical.length - 1
      ],

      ...result.forecast
    ];

  chartInstances[parameter] =
    new Chart(
      canvas.getContext("2d"),
      {

        type: "line",

        data: {

          labels,

          datasets: [

            {
              label:
                `${result.name} Aktual`,

              data:
                actualData,

              tension: 0.2,

              pointRadius: 1,

              borderWidth: 2
            },

            {
              label:
                `${result.name} Forecast`,

              data:
                forecastData,

              tension: 0.2,

              pointRadius: 1,

              borderWidth: 2,

              borderDash: [
                6,
                4
              ]
            }

          ]

        },

        options: {

          responsive: true,

          maintainAspectRatio: false,

          interaction: {
            mode: "index",
            intersect: false
          },

          plugins: {

            legend: {
              display: true
            },

            tooltip: {
              enabled: true
            }

          },

          scales: {

            x: {

              ticks: {
                maxTicksLimit: 15
              }

            },

            y: {

              title: {

                display: true,

                text:
                  `${result.name} (${result.unit})`

              }

            }

          }

        }

      }
    );
}


// ============================================================
// MEMBUAT TABEL FORECAST
// ============================================================

function createForecastTable(
  parameter,
  result
) {

  const table =
    document.getElementById(
      `table-${parameter}`
    );

  if (!table) {
    return;
  }

  const tbody =
    table.querySelector(
      "tbody"
    );

  tbody.innerHTML = "";

  result.forecast.forEach(
    (value, index) => {

      const row =
        document.createElement(
          "tr"
        );

      row.innerHTML = `

        <td>
          ${index + 1}
        </td>

        <td>
          ${result.dates[index]}
        </td>

        <td>
          ${formatNumber(value)}
          ${result.unit}
        </td>

      `;

      tbody.appendChild(
        row
      );

    }
  );
}


// ============================================================
// RINGKASAN PARAMETER
// ============================================================

function createSummary(
  parameter,
  result
) {

  const element =
    document.getElementById(
      `summary-${parameter}`
    );

  if (!element) {
    return;
  }

  const forecast =
    result.forecast;

  if (
    !forecast ||
    forecast.length === 0
  ) {

    element.innerHTML =
      "Tidak ada hasil forecast.";

    return;
  }

  const min =
    Math.min(...forecast);

  const max =
    Math.max(...forecast);

  const avg =
    forecast.reduce(
      (sum, value) =>
        sum + value,
      0
    ) /
    forecast.length;

  element.innerHTML = `

    <div>
      <strong>
        Data training:
      </strong>
      ${result.historicalCount}
    </div>

    <div>
      <strong>
        Sequence:
      </strong>
      ${result.trainingSequences}
    </div>

    <div>
      <strong>
        Forecast:
      </strong>
      ${forecast.length} langkah
    </div>

    <div>
      <strong>
        Minimum:
      </strong>
      ${formatNumber(min)}
      ${result.unit}
    </div>

    <div>
      <strong>
        Maksimum:
      </strong>
      ${formatNumber(max)}
      ${result.unit}
    </div>

    <div>
      <strong>
        Rata-rata:
      </strong>
      ${formatNumber(avg)}
      ${result.unit}
    </div>

  `;
}


// ============================================================
// MENAMPILKAN HASIL PARAMETER
// ============================================================

function displayResult(
  parameter,
  result
) {

  const status =
    document.getElementById(
      `status-${parameter}`
    );

  if (!status) {
    return;
  }

  if (
    result.status ===
    "insufficient"
  ) {

    status.innerHTML =
      "Data tidak cukup untuk training.";

    status.className =
      "forecast-status warning";

    return;
  }

  status.innerHTML =
    `Berhasil: ${result.forecast.length} langkah forecast`;

  status.className =
    "forecast-status success";

  createChart(
    parameter,
    result
  );

  createForecastTable(
    parameter,
    result
  );

  createSummary(
    parameter,
    result
  );
}


// ============================================================
// PROSES SEMUA PARAMETER
// ============================================================

async function runAllForecast() {

  try {

    log(
      "========================================"
    );

    log(
      "MEMULAI LSTM MULTI-PARAMETER"
    );

    log(
      `Sumber data: ${FIREBASE_PATH}`
    );

    log(
      `Lookback: ${LOOKBACK} titik data`
    );

    log(
      `Forecast: ${FORECAST_STEPS} langkah`
    );

    log(
      "========================================"
    );

    // --------------------------------------------------------
    // Buat container
    // --------------------------------------------------------

    createResultContainers();

    // --------------------------------------------------------
    // Ambil Firebase
    // --------------------------------------------------------

    await loadFirebaseData();

    // --------------------------------------------------------
    // Proses satu per satu
    // --------------------------------------------------------
    //
    // Sengaja tidak menggunakan Promise.all()
    // supaya browser tidak menjalankan 5 model
    // secara bersamaan.
    //

    for (
      const parameter of
      Object.keys(PARAMETERS)
    ) {

      try {

        const result =
          await trainAndForecast(
            parameter
          );

        forecastResults[
          parameter
        ] = result;

        displayResult(
          parameter,
          result
        );

      } catch (error) {

        console.error(
          parameter,
          error
        );

        log(
          `ERROR ${PARAMETERS[parameter].name}: ${error.message}`
        );

        const status =
          document.getElementById(
            `status-${parameter}`
          );

        if (status) {

          status.innerHTML =
            `Gagal: ${error.message}`;

          status.className =
            "forecast-status error";
        }
      }

    }

    log(
      "========================================"
    );

    log(
      "SEMUA PROSES LSTM SELESAI"
    );

    log(
      "========================================"
    );

  } catch (error) {

    console.error(error);

    log(
      "PROSES GAGAL: " +
      error.message
    );
  }
}


// ============================================================
// INFORMASI INTERVAL DATA
// ============================================================

function showDataInfo() {

  const interval =
    calculateInterval(
      firebaseData
    );

  const info =
    document.getElementById(
      "dataInfo"
    );

  if (!info) {
    return;
  }

  if (!interval) {

    info.innerHTML = `
      <strong>Data:</strong>
      ${firebaseData.length} titik<br>
      <strong>Interval:</strong>
      Tidak dapat ditentukan
    `;

    return;
  }

  info.innerHTML = `
    <strong>Data:</strong>
    ${firebaseData.length} titik<br>

    <strong>Interval median:</strong>
    ${formatInterval(interval)}<br>

    <strong>Forecast:</strong>
    ${FORECAST_STEPS} langkah
  `;
}


// ============================================================
// TOMBOL MULAI
// ============================================================

function setupButton() {

  const button =
    document.getElementById(
      "startLSTM"
    );

  if (!button) {
    return;
  }

  button.addEventListener(
    "click",
    async () => {

      button.disabled = true;

      button.innerText =
        "Memproses LSTM...";

      try {

        await runAllForecast();

      } finally {

        button.disabled = false;

        button.innerText =
          "Mulai Forecast";
      }

    }
  );
}


// ============================================================
// SAAT HALAMAN SELESAI DIMUAT
// ============================================================

document.addEventListener(
  "DOMContentLoaded",
  () => {

    log(
      "Halaman LSTM siap."
    );

    log(
      `Sumber data: ${FIREBASE_PATH}`
    );

    log(
      `Parameter: ${Object.keys(PARAMETERS).length}`
    );

    log(
      `Forecast: ${FORECAST_STEPS} langkah`
    );

    setupButton();

  }
);


// ============================================================
// EKSPOR UNTUK DEBUGGING
// ============================================================

window.lstmForecastResults =
  forecastResults;

window.runLSTM =
  runAllForecast;
