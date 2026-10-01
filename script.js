// ===== 1. CONFIGURAÇÕES (mude aqui os valores sem mexer no resto) =====

// Origem: Uninassau Parangaba. Tentamos achar a coordenada exata pela API;
// se falhar, usamos esta coordenada aproximada do bairro.
const ORIGEM_ENDERECO = "Rua Germano Franck, 567, Parangaba, Fortaleza, CE, Brasil";
const ORIGEM_APROXIMADA = { lat: -3.7766, lon: -38.5590 };

// Fórmula ESTIMADA do Uber Moto (o Uber não tem API pública de preços)
const UBER_BASE = 2.0;      // valor fixo da corrida (R$)
const UBER_POR_KM = 1.1;    // R$ por km
const UBER_POR_MIN = 0.25;  // R$ por minuto
const UBER_MINIMO = 6.0;    // corrida mínima (R$)

// Frete = preço do Uber Moto + taxa fixa de serviço
const TAXA_SERVICO = 3.0;

// ===== 2. ELEMENTOS DA PÁGINA =====
const form = document.getElementById("form-cep");
const campoCep = document.getElementById("cep");
const campoNumero = document.getElementById("numero");
const botao = document.getElementById("botao");
const status = document.getElementById("status");
const resultado = document.getElementById("resultado");

let origemCache = null; // guarda a origem para não buscar toda vez

// ===== 3. FUNÇÕES AUXILIARES =====
const moeda = valor => valor.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

function mostrarStatus(texto, erro = false) {
  status.textContent = texto;
  status.classList.toggle("erro", erro);
}

// Máscara: vai colocando o hífen enquanto a pessoa digita (12345678 -> 12345-678)
campoCep.addEventListener("input", () => {
  const numeros = campoCep.value.replace(/\D/g, "").slice(0, 8);
  campoCep.value = numeros.length > 5 ? `${numeros.slice(0, 5)}-${numeros.slice(5)}` : numeros;
});

// API 1: ViaCEP transforma o CEP em endereço
async function buscarCep(cep) {
  const resposta = await fetch(`https://viacep.com.br/ws/${cep}/json/`);
  if (!resposta.ok) throw new Error("Não foi possível consultar o CEP.");
  const dados = await resposta.json();
  if (dados.erro) throw new Error("CEP não encontrado.");
  return dados;
}

// API 2: Nominatim (OpenStreetMap) transforma texto de endereço em latitude/longitude
async function geocodificar(texto) {
  const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=br&q=${encodeURIComponent(texto)}`;
  const resposta = await fetch(url);
  if (!resposta.ok) return null;
  const lista = await resposta.json();
  return lista.length ? { lat: Number(lista[0].lat), lon: Number(lista[0].lon) } : null;
}

// API 3: OSRM calcula a rota de carro e devolve distância (metros) e duração (segundos)
async function calcularRota(a, b) {
  try {
    const url = `https://router.project-osrm.org/route/v1/driving/${a.lon},${a.lat};${b.lon},${b.lat}?overview=false`;
    const resposta = await fetch(url);
    const dados = await resposta.json();
    const rota = dados.routes[0];
    return { km: rota.distance / 1000, min: rota.duration / 60 };
  } catch (erro) {
    // Plano B: distância em linha reta (fórmula de Haversine) +30% pelas curvas das ruas
    const km = haversine(a, b) * 1.3;
    return { km, min: (km / 25) * 60 }; // velocidade média de 25 km/h
  }
}

function haversine(a, b) {
  const rad = graus => (graus * Math.PI) / 180;
  const R = 6371; // raio da Terra em km
  const dLat = rad(b.lat - a.lat);
  const dLon = rad(b.lon - a.lon);
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}

// ===== 4. O CÁLCULO DE PREÇO =====
function precoUberMoto(km, min) {
  const preco = UBER_BASE + km * UBER_POR_KM + min * UBER_POR_MIN;
  return Math.max(preco, UBER_MINIMO); // nunca abaixo do mínimo
}

// ===== 5. QUANDO O USUÁRIO ENVIA O FORMULÁRIO =====
form.addEventListener("submit", async evento => {
  evento.preventDefault();
  const cep = campoCep.value.replace(/\D/g, "");

  if (cep.length !== 8) {
    mostrarStatus("Digite um CEP com 8 números.", true);
    return;
  }

  botao.disabled = true;
  resultado.hidden = true;

  try {
    mostrarStatus("Consultando o CEP...");
    const end = await buscarCep(cep);

    mostrarStatus("Localizando o endereço no mapa...");
    if (!origemCache) {
      origemCache = (await geocodificar(ORIGEM_ENDERECO)) || ORIGEM_APROXIMADA;
    }

    // Tentamos do mais preciso para o menos preciso
    const numero = campoNumero.value.trim();
    const ruaCompleta = `${end.logradouro}${numero ? ", " + numero : ""}, ${end.bairro}, ${end.localidade}, ${end.uf}, Brasil`;
    const bairro = `${end.bairro}, ${end.localidade}, ${end.uf}, Brasil`;
    const destino = (end.logradouro && (await geocodificar(ruaCompleta))) || (await geocodificar(bairro));

    if (!destino) throw new Error("Não conseguimos localizar esse endereço no mapa.");

    mostrarStatus("Calculando a rota...");
    const rota = await calcularRota(origemCache, destino);
    const uber = precoUberMoto(rota.km, rota.min);
    const frete = uber + TAXA_SERVICO;

    // Mostra o resultado (textContent = texto puro, mais seguro que innerHTML)
    document.getElementById("endereco").textContent =
      `${end.logradouro || "Endereço sem rua específica"}, ${end.bairro} · ${end.localidade}/${end.uf}`;
    document.getElementById("distancia").textContent = `${rota.km.toFixed(1).replace(".", ",")} km`;
    document.getElementById("tempo").textContent = `${Math.round(rota.min)} min`;
    document.getElementById("uber").textContent = moeda(uber);
    document.getElementById("frete").textContent = moeda(frete);

    resultado.hidden = false;
    mostrarStatus("");
    resultado.scrollIntoView({ behavior: "smooth" });
  } catch (erro) {
    mostrarStatus(erro.message || "Algo deu errado. Tente novamente.", true);
  } finally {
    botao.disabled = false; // roda sempre, com sucesso ou erro
  }
});
