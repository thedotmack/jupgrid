// #region imports
import axios from 'axios';
import bs58 from 'bs58';
import chalk from 'chalk';
import fetch from 'cross-fetch';
import * as fs from 'fs';
import ora from 'ora';
import Websocket from 'ws';

import {
	LimitOrderProvider,
	ownerFilter
} from '@jup-ag/limit-order-sdk';
import { program } from '@project-serum/anchor/dist/cjs/native/system.js';
import * as solanaWeb3 from '@solana/web3.js';
import {
	Connection,
	Keypair,
	PublicKey,
	SystemProgram,
	TransactionMessage,
	VersionedTransaction
} from '@solana/web3.js';

import {
	envload,
	loaduserSettings,
	saveuserSettings
} from './settings.js';
import {
	delay,
	downloadTokensList,
	getTokenAccounts,
	getTokens,
	questionAsync,
	rl
} from './utils.js';
import logger from './logger.js';

// #endregion

// #region constants
// use fs to to read version from package.json
const packageInfo = JSON.parse(fs.readFileSync("package.json", "utf8"));

const version = packageInfo.version;
const versionNumber = version

const [MIN_WAIT, MAX_WAIT] = [5e2, 5e3];

const [payer, rpcUrl] = envload();

const connection = new Connection(rpcUrl, "processed", {
	confirmTransactionInitialTimeout: 5000
});
const limitOrder = new LimitOrderProvider(connection);

let shutDown = false;

const walletAddress = payer.publicKey.toString();
const displayAddress = `${walletAddress.slice(0, 4)}...${walletAddress.slice(-4)}`;

const quoteurl = "https://quote-api.jup.ag/v6/quote";
const JitoBlockEngine = "https://mainnet.block-engine.jito.wtf/api/v1/bundles";

const TIP_ACCOUNTS = [
	"96gYZGLnJYVFmbjzopPSU6QiEV5fGqZNyN9nmNhvrZU5",
	"HFqU5x63VTqvQss8hp11i4wVV8bD44PvwucfZ2bU7gRe",
	"Cw8CFyM9FkoMi7K7Crf6HNQqf4uEMzpKw6QNghXLvLkY",
	"ADaUMid9yfUytqMBgopwjb2DTLSokTSzL1zt6iGPaS49",
	"DfXygSm4jCyNCybVYYK6DwvWqjKee8pbDmJGcLWNDXjh",
	"ADuUkR4vqLUMWXxW9gh6D6L8pMSawimctcNZ5pGwDcEt",
	"DttWaMuVvTiduZRnguLF7jNxTgiMBZ1hyAumKUiL2KRL",
	"3AVi9Tg9Uo68tJfuvoKvqKNWKkC5wPdSSdeBnizKZ6jT"
];

const USDC_MINT_ADDRESS = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const SOL_MINT_ADDRESS = "So11111111111111111111111111111111111111112";

const getRandomTipAccount = () =>
	TIP_ACCOUNTS[Math.floor(Math.random() * TIP_ACCOUNTS.length)];

// Save the original console.log function
const originalConsoleLog = console.log;

// Override console.log
console.log = function(message) {
  // Log the message to the console as usual
  originalConsoleLog(message);

  // Also log message to the file
  logger.info(message);
};

// #endregion

// #region properties
let {
	validTokenA = null,
	validTokenB = null,
	selectedTokenA = null,
	selectedTokenB = null,
	selectedAddressA = null,
	selectedAddressB = null,
	selectedDecimalsA = null,
	selectedDecimalsB = null,
	validSpread = null,
	stopLossUSD = null,
	infinityTarget = null,
	loaded = false,
	openOrders = [],
	checkArray = [],
	tokens = [],
	newPrice = null,
	startPrice = null,
	spread = null,
	spreadbps = null,
	initBalanceA = 0,
	initUsdBalanceA = 0,
	initBalanceB = 0,
	initUsdBalanceB = 0,
	currBalanceA = 0,
	currBalanceB = 0,
	currUSDBalanceA = 0,
	currUSDBalanceB = 0,
	initUsdTotalBalance = 0,
	currUsdTotalBalance = 0,
	tokenRebalanceValue = null,
	tokenARebalanceValue = 0,
	tokenBRebalanceValue = 0,
	startTime = new Date(),
	monitorDelay = null,
	adjustmentA = 0,
	adjustmentB = 0,
	stopLoss = false,
	jitoRetry = 0,
	infinityBuyInputLamports,
	infinityBuyOutputLamports,
	infinitySellInputLamports,
	infinitySellOutputLamports,
	counter = 0,
	askForRebalance = true,
	rebalanceCounter = 0,
	newPriceBUp = null,
	newPriceBDown = null,
	lastKnownPrice = null,
	userSettings = {
		selectedTokenA: null,
		selectedTokenB: null,
		tradeSize: null,
		spread: null,
		rebalanceAllowed: null,
		rebalancePercentage: null,
		rebalanceSlippageBPS: null,
		monitorDelay: null,
		stopLossUSD: null,
		infinityTarget: null,
		infinityMode: null
	}
} = {};
// #endregion

async function loadQuestion() {
	try {
		await downloadTokensList();
		console.log("Updated Token List\n");
		console.log(`Connected Wallet: ${displayAddress}\n`);

		if (!fs.existsSync("userSettings.json")) {
			console.log("No user data found. Starting with fresh inputs.");
			initialize();
		} else {
			const askForLoadSettings = () => {
				rl.question(
					"Do you wish to load your saved settings? (Y/N): ",
					function (responseQ) {
						responseQ = responseQ.toUpperCase(); // Case insensitivity

						if (responseQ === "Y") {
							try {
								// Show user data
								const userSettings = loaduserSettings();
								// Check if the saved version matches the current version
									if (userSettings.versionNumber !== version) {
										console.log(`Version mismatch detected. Your settings version: ${userSettings.versionNumber}, current version: ${version}.`);
										// Here you can choose to automatically initialize with fresh settings
										// or prompt the user for an action (e.g., update settings, discard, etc.)
										console.log("Changing to blank settings, please continue.\n");
										initialize(); // Example action: re-initialize with fresh settings
										return;
									}
								console.log("User data loaded successfully.");
								console.log(
									`\nPrevious JupGrid Settings:
Version: ${userSettings.versionNumber}
Token A: ${chalk.cyan(userSettings.selectedTokenA)}
Token B: ${chalk.magenta(userSettings.selectedTokenB)}
Infinity Target: ${userSettings.infinityTarget}
Spread: ${userSettings.spread}%
Stop Loss: ${userSettings.stopLossUSD}
Monitoring delay: ${userSettings.monitorDelay}ms\n`
								);
								// Prompt for confirmation to use these settings
								rl.question(
									"Proceed with these settings? (Y/N): ",
									function (confirmResponse) {
										confirmResponse =
											confirmResponse.toUpperCase();
										if (confirmResponse === "Y") {
											// Apply loaded settings
											({
												versionNumber,
												selectedTokenA,
												selectedAddressA,
												selectedDecimalsA,
												selectedTokenB,
												selectedAddressB,
												selectedDecimalsB,
												spread,
												monitorDelay,
												stopLossUSD,
												infinityTarget
											} = userSettings);
											console.log(
												"Settings applied successfully!"
											);
											initialize();
										} else if (confirmResponse === "N") {
											console.log(
												"Discarding saved settings, please continue."
											);
											initialize(); // Start initialization with blank settings
										} else {
											console.log(
												"Invalid response. Please type 'Y' or 'N'."
											);
											askForLoadSettings(); // Re-ask the original question
										}
									}
								);
							} catch (error) {
								console.error(
									`Failed to load settings: ${error}`
								);
								initialize(); // Proceed with initialization in case of error
							}
						} else if (responseQ === "N") {
							console.log("Starting with blank settings.");
							initialize();
						} else {
							console.log(
								"Invalid response. Please type 'Y' or 'N'."
							);
							askForLoadSettings(); // Re-ask if the response is not Y/N
						}
					}
				);
			};

			askForLoadSettings(); // Start the question loop
		}
	} catch (error) {
		console.error("Error:", error);
	}
}

async function initialize() {
	if (selectedTokenA === "USDC") {
		validTokenA = true;
	}
	if (selectedTokenB != null) {
		validTokenB = true;
	}
	if (spread != null) {
		validSpread = true;
	}
	let validMonitorDelay = false;
	if (monitorDelay >= 5000) {
		validMonitorDelay = true;
	}
	let validStopLossUSD = false;
	if (stopLossUSD != null) {
		validStopLossUSD = true;
	}
	let validInfinityTarget = false;
	if (infinityTarget != null) {
		validInfinityTarget = true;
	}

	tokens = await getTokens();

	if (userSettings.selectedTokenA) {
  	const tokenAExists = tokens.some(
    (token) => token.symbol === userSettings.selectedTokenA
  	);
  	if (!tokenAExists) {
    console.log(
      `Token ${userSettings.selectedTokenA} from user data not found in the updated token list. Please re-enter.`
    );
    userSettings.selectedTokenA = null; // Reset selected token A
    userSettings.selectedAddressA = null; // Reset selected address
    userSettings.selectedDecimalsA = null; // Reset selected token decimals
  } else {
    validTokenA = true;
  }
}

while (!validTokenA) {
	console.log("During this Beta stage, we are only allowing USDC as Token A. Is that ok?");
	// Simulate the user entered 'USDC' as their answer
	const answer = 'USDC';

  const token = tokens.find((t) => t.symbol === answer);
  if (token) {
    console.log(`Selected Token: ${token.symbol}
Token Address: ${token.address}
Token Decimals: ${token.decimals}`);
    const confirmAnswer = await questionAsync(
      `Is this the correct token? (Y/N): `
    );
    if (
      confirmAnswer.toLowerCase() === "y" ||
      confirmAnswer.toLowerCase() === "yes"
    ) {
      validTokenA = true;
      selectedTokenA = token.symbol;
      selectedAddressA = token.address;
      selectedDecimalsA = token.decimals;
    }
  } else {
    console.log(`Token ${answer} not found. Please Try Again.`);
  }
}

	if (userSettings.selectedTokenB) {
		const tokenBExists = tokens.some(
			(token) => token.symbol === userSettings.selectedTokenB
		);
		if (!tokenBExists) {
			console.log(
				`Token ${userSettings.selectedTokenB} from user data not found in the updated token list. Please re-enter.`
			);
			userSettings.selectedTokenB = null; // Reset selected token B
			userSettings.selectedAddressB = null; // Reset selected address
			userSettings.selectedDecimalsB = null; // Reset selected token decimals
		} else {
			validTokenB = true;
		}
	}

	while (!validTokenB) {
		const answer = await questionAsync(
			`Please Enter The Second Token Symbol (B) (Case Sensitive): `
		);
		const token = tokens.find((t) => t.symbol === answer);
		if (token) {
			console.log(`Selected Token: ${token.symbol}
Token Address: ${token.address}
Token Decimals: ${token.decimals}`);
			const confirmAnswer = await questionAsync(
				`Is this the correct token? (Y/N): `
			);
			if (
				confirmAnswer.toLowerCase() === "y" ||
				confirmAnswer.toLowerCase() === "yes"
			) {
				validTokenB = true;
				selectedTokenB = token.symbol;
				selectedAddressB = token.address;
				selectedDecimalsB = token.decimals;
			}
		} else {
			console.log(`Token ${answer} not found. Please Try Again.`);
		}
	}

	// If infinity target value is not valid, prompt the user
	while (!validInfinityTarget) {
		const infinityTargetInput = await questionAsync(
			`Please Enter the Infinity Target Value: `
		);
		infinityTarget = Math.floor(parseFloat(infinityTargetInput));
		if (
			!isNaN(infinityTarget) &&
			Number.isInteger(infinityTarget) &&
			infinityTarget > userSettings.stopLossUSD
		) {
			userSettings.infinityTarget = infinityTarget;
			validInfinityTarget = true;
		} else {
			console.log(
				"Invalid infinity target value. Please enter a valid integer that is larger than the stop loss value."
			);
		}
	}

	// Ask user for spread %
	// Check if spread percentage is valid
	if (userSettings.spread) {
		validSpread = !isNaN(parseFloat(userSettings.spread));
		if (!validSpread) {
			console.log(
				"Invalid spread percentage found in user data. Please re-enter."
			);
			userSettings.spread = null; // Reset spread percentage
		} else validSpread = true;
	}

	// If spread percentage is not valid, prompt the user
	while (!validSpread) {
		const spreadInput = await questionAsync(
			"What % Spread Difference Between Market and Orders? Recommend >0.3% to cover Jupiter Fees, but 1% or greater for best performance:"
		);
		spread = parseFloat(spreadInput);
		if (!isNaN(spread)) {
			userSettings.spread = spread;
			validSpread = true;
		} else {
			console.log(
				"Invalid spread percentage. Please enter a valid number (No % Symbol)."
			);
		}
	}

	if (userSettings.stopLossUSD) {
		validStopLossUSD = !isNaN(parseFloat(userSettings.stopLossUSD));
		if (!validStopLossUSD) {
			console.log(
				"Invalid stop loss value found in user data. Please re-enter."
			);
			userSettings.stopLossUSD = null; // Reset stop loss value
		} else validStopLossUSD = true;
	}

	// If stop loss value is not valid, prompt the user
	while (!validStopLossUSD) {
		const stopLossUSDInput = await questionAsync(
			`Please Enter the Stop Loss Value in USD: (Enter 0 for no stoploss) `
		);
		stopLossUSD = parseFloat(stopLossUSDInput);
		if (!isNaN(stopLossUSD)) {
			userSettings.stopLossUSD = stopLossUSD;
			validStopLossUSD = true;
		} else {
			console.log(
				"Invalid stop loss value. Please enter a valid number."
			);
		}
	}

	while (!validMonitorDelay) {
		const monitorDelayQuestion = await questionAsync(
			`Enter the delay between price checks in milliseconds (minimum 5000ms): `
		);
		const parsedMonitorDelay = parseInt(monitorDelayQuestion.trim());
		if (!isNaN(parsedMonitorDelay) && parsedMonitorDelay >= 5000) {
			monitorDelay = parsedMonitorDelay;
			validMonitorDelay = true;
		} else {
			console.log(
				"Invalid monitor delay. Please enter a valid number greater than or equal to 5000."
			);
		}
	}

	spreadbps = spread * 100;
	//rl.close(); // Close the readline interface after question loops are done.

	saveuserSettings(
		versionNumber,
		selectedTokenA,
		selectedAddressA,
		selectedDecimalsA,
		selectedTokenB,
		selectedAddressB,
		selectedDecimalsB,
		spread,
		monitorDelay,
		stopLossUSD,
		infinityTarget
	);
	// First Price check during init
	console.log("Getting Latest Price Data...");
	newPrice = await fetchPrice(selectedAddressB);
	startPrice = newPrice;

	console.clear();
	console.log(`Starting JupGrid v${version}
Your Token Selection for A - Symbol: ${chalk.cyan(selectedTokenA)}, Address: ${chalk.cyan(selectedAddressA)}
Your Token Selection for B - Symbol: ${chalk.magenta(selectedTokenB)}, Address: ${chalk.magenta(selectedAddressB)}`);
	startInfinity();
}

if (loaded === false) {
	loadQuestion();
}

async function startInfinity() {
	console.log(`Checking for existing orders to cancel...`);
	await jitoController("cancel");
	const initialBalances = await getBalance(
		payer,
		selectedAddressA,
		selectedAddressB,
		selectedTokenA,
		selectedTokenB
	);
	initBalanceA = initialBalances.balanceA;
	initUsdBalanceA = initialBalances.usdBalanceA;
	initBalanceB = initialBalances.balanceB;
	initUsdBalanceB = initialBalances.usdBalanceB;
	initUsdTotalBalance = initUsdBalanceA + initUsdBalanceB;
	infinityGrid();
}

async function getBalance(
	payer,
	selectedAddressA,
	selectedAddressB,
	selectedTokenA,
	selectedTokenB
) {
	async function getSOLBalanceAndUSDC() {
		const lamports = await connection.getBalance(payer.publicKey);
		const solBalance = lamports / solanaWeb3.LAMPORTS_PER_SOL;
		if (solBalance === 0) {
			console.log(`You do not have any SOL, please check and try again.`);
			process.exit(0);
		}
		let usdBalance = 0;
		if (selectedTokenA === "SOL" || selectedTokenB === "SOL") {
			try {
				const queryParams = {
					inputMint: SOL_MINT_ADDRESS,
					outputMint: USDC_MINT_ADDRESS,
					amount: lamports, // Amount in lamports
					slippageBps: 0
				};
				const response = await axios.get(quoteurl, {
					params: queryParams
				});
				usdBalance = response.data.outAmount / Math.pow(10, 6) || 0;
				tokenRebalanceValue =
					response.data.outAmount / (lamports / Math.pow(10, 3));
			} catch (error) {
				console.error("Error fetching USDC equivalent for SOL:", error);
			}
		}
		return { balance: solBalance, usdBalance, tokenRebalanceValue };
	}

	async function getTokenAndUSDCBalance(mintAddress, decimals) {
		if (
			!mintAddress ||
			mintAddress === "So11111111111111111111111111111111111111112"
		) {
			return getSOLBalanceAndUSDC();
		}

		const tokenAccounts = await getTokenAccounts(
			connection,
			payer.publicKey,
			mintAddress
		);
		if (tokenAccounts.value.length > 0) {
			const balance =
				tokenAccounts.value[0].account.data.parsed.info.tokenAmount
					.uiAmount;
			let usdBalance = 0;
			if (balance === 0) {
				console.log(
					`You do not have a balance for ${mintAddress}, please check and try again.`
				);
				process.exit(0);
			}
			if (mintAddress !== USDC_MINT_ADDRESS) {
				const queryParams = {
					inputMint: mintAddress,
					outputMint: USDC_MINT_ADDRESS,
					amount: Math.floor(balance * Math.pow(10, decimals)),
					slippageBps: 0
				};

				try {
					const response = await axios.get(quoteurl, {
						params: queryParams
					});
					// Save USD Balance and adjust down for Lamports
					usdBalance = response.data.outAmount / Math.pow(10, 6);
					tokenRebalanceValue =
						response.data.outAmount / (balance * Math.pow(10, 6));
				} catch (error) {
					console.error("Error fetching USDC equivalent:", error);
					usdBalance = 1;
				}
			} else {
				usdBalance = balance; // If the token is USDC, its balance is its USD equivalent
				if (usdBalance === 0) {
					console.log(
						`You do not have any USDC, please check and try again.`
					);
					process.exit(0);
				}
				tokenRebalanceValue = 1;
			}

			return { balance, usdBalance, tokenRebalanceValue };
		} else {
			return { balance: 0, usdBalance: 0, tokenRebalanceValue: null };
		}
	}

	const resultA = await getTokenAndUSDCBalance(
		selectedAddressA,
		selectedDecimalsA
	);
	const resultB = await getTokenAndUSDCBalance(
		selectedAddressB,
		selectedDecimalsB
	);

	if (resultA.balance === 0 || resultB.balance === 0) {
		console.log(
			"Please ensure you have a balance in both tokens to continue."
		);
		process.exit(0);
	}

	return {
		balanceA: resultA.balance,
		usdBalanceA: resultA.usdBalance,
		tokenARebalanceValue: resultA.tokenRebalanceValue,
		balanceB: resultB.balance,
		usdBalanceB: resultB.usdBalance,
		tokenBRebalanceValue: resultB.tokenRebalanceValue
	};
}

function formatElapsedTime(startTime) {
	const currentTime = new Date();
	const elapsedTime = currentTime - startTime; // Difference in milliseconds

	let totalSeconds = Math.floor(elapsedTime / 1000);
	let hours = Math.floor(totalSeconds / 3600);
	totalSeconds %= 3600;
	let minutes = Math.floor(totalSeconds / 60);
	let seconds = totalSeconds % 60;

	// Padding with '0' if necessary
	hours = String(hours).padStart(2, "0");
	minutes = String(minutes).padStart(2, "0");
	seconds = String(seconds).padStart(2, "0");

	console.log(`\u{23F1}  Run time: ${hours}:${minutes}:${seconds}`);
}

async function monitor() {
	if (shutDown) return;
	const maxRetries = 5;
	let retries = 0;
	await updateMainDisplay();
	while (retries < maxRetries) {
		try {
			await checkOpenOrders();
			await handleOrders(checkArray);
			break; // Break the loop if we've successfully handled the price monitoring
		} catch (error) {
			console.log(error);
			console.error(
				`Error: Connection or Token Data Error (Monitor Price) - (Attempt ${retries + 1} of ${maxRetries})`
			);
			retries++;

			if (retries === maxRetries) {
				console.error(
					"Maximum number of retries reached. Unable to retrieve data."
				);
				return null;
			}
		}
	}
}

async function handleOrders(checkArray) {
	if (checkArray.length !== 2) {
		infinityGrid();
	} else {
		console.log("2 open orders. Waiting for change.");
		await delay(monitorDelay);
		await monitor();
	}
}

async function infinityGrid() {
	if (shutDown) return;

	// Increment trades counter
	counter++;

	// Cancel any existing orders
	await jitoController("cancel");

	// Check to see if we need to rebalance
	await jitoController("rebalance");
	askForRebalance = false;

    // Get the current balances
    const { balanceA, balanceB } = await getBalance(payer, selectedAddressA, selectedAddressB, selectedTokenA, selectedTokenB);
    let balanceALamports = balanceA * Math.pow(10, selectedDecimalsA);
    let balanceBLamports = balanceB * Math.pow(10, selectedDecimalsB);

    // Get the current market price
    const marketPrice = await fetchPrice(selectedAddressB);
	await delay(1000)
	const marketPrice2 = await fetchPrice(selectedAddressB);
	await delay(1000)
	const marketPrice3 = await fetchPrice(selectedAddressB);
	const averageMarketPrice = (marketPrice + marketPrice2 + marketPrice3) / 3;
    currUsdTotalBalance = balanceA + (balanceB * averageMarketPrice);
	console.log(`Current USD Total Balance: ${currUsdTotalBalance}`)

	// Emergency Stop Loss
	if (currUsdTotalBalance < stopLossUSD) {
		console.clear();
		console.log(`\n\u{1F6A8} Emergency Stop Loss Triggered! - Exiting`);
		stopLoss = true;
		process.kill(process.pid, "SIGINT");
	}
    // Calculate the new prices of tokenB when it's up and down by the spread%
    newPriceBUp = averageMarketPrice * (1 + spreadbps / 10000);
    newPriceBDown = averageMarketPrice * (1 - spreadbps / 10000);
    
    // Calculate the current value of TokenB in USD
    const currentValueUSD = balanceBLamports / Math.pow(10, selectedDecimalsB) * averageMarketPrice;
    
    // Calculate the target value of TokenB in USD at the new prices
    const targetValueUSDUp = balanceBLamports / Math.pow(10, selectedDecimalsB) * newPriceBUp;
    const targetValueUSDDown = balanceBLamports / Math.pow(10, selectedDecimalsB) * newPriceBDown;
    
    // Calculate the initial lamports to sell and buy
    let lamportsToSellInitial = Math.floor((targetValueUSDUp - infinityTarget) / newPriceBUp * Math.pow(10, selectedDecimalsB));
    let lamportsToBuyInitial = Math.floor((infinityTarget - targetValueUSDDown) / newPriceBDown * Math.pow(10, selectedDecimalsB));

    // Adjust the lamports to buy based on the potential cancellation of the sell order
    let lamportsToBuy = lamportsToBuyInitial - lamportsToSellInitial;

    // lamportsToSell remains the same as lamportsToSellInitial
    let lamportsToSell = lamportsToSellInitial;

    // Calculate the expected USDC for the sell and buy
	const decimalDiff = selectedDecimalsB - selectedDecimalsA;
    const expectedUSDCForSell = (lamportsToSell * newPriceBUp) / Math.pow(10, selectedDecimalsB);
    const expectedUSDCForBuy = (lamportsToBuy * newPriceBDown) / Math.pow(10, selectedDecimalsB);
    const expectedUSDCForSellLamports = Math.floor((lamportsToSell * newPriceBUp) / Math.pow(10, decimalDiff));
	const expectedUSDCForBuyLamports = Math.floor((lamportsToBuy * newPriceBDown) / Math.pow(10, decimalDiff));

    // Derive the MarketUp and MarketDown prices from the lamports to buy/sell
    const derivedMarketPriceUp = expectedUSDCForSellLamports / lamportsToSell;
    const derivedMarketPriceDown = expectedUSDCForBuyLamports / lamportsToBuy;

	//Translate variables to be used for jitoController
	infinityBuyInputLamports = expectedUSDCForBuyLamports;
	infinityBuyOutputLamports = lamportsToBuy;
	infinitySellInputLamports = lamportsToSell;
	infinitySellOutputLamports = expectedUSDCForSellLamports;

	// Check if the balances are enough to place the orders (With a 5% buffer)
	if (infinitySellInputLamports > balanceBLamports * 1.05) {
		console.log("Token B Balance not enough to place Sell Order. Exiting.");
		process.kill(process.pid, "SIGINT");
	}
	if (infinityBuyInputLamports > balanceALamports * 1.05) {
		console.log("Token A Balance not enough to place Buy Order. Exiting.");
		process.kill(process.pid, "SIGINT");
	}
    // Log the values

	/*
    console.log(`TokenA Balance: ${balanceA}`);
    console.log(`TokenA Balance Lamports: ${balanceALamports}`);
    console.log(`TokenB Balance: ${balanceB}`);
    console.log(`TokenB Balance Lamports: ${balanceBLamports}`);
    console.log(`TokenB Balance USD: ${currentValueUSD}`);
    console.log(`Infinity Target: ${infinityTarget}`);
    console.log(`Market Price: ${marketPrice.toFixed(2)}`);
    console.log(`Market Price Up: ${newPriceBUp.toFixed(2)}`);
    console.log(`Derived Market Price Up: ${derivedMarketPriceUp.toFixed(2)}`);
    console.log(`Market Price Down: ${newPriceBDown.toFixed(2)}`);
    console.log(`Derived Market Price Down: ${derivedMarketPriceDown.toFixed(2)}`);
    console.log(`Target Value of TokenB in USD Up: ${targetValueUSDUp}`);
    console.log(`Target Value of TokenB in USD Down: ${targetValueUSDDown}`);
    console.log(`Lamports to Sell: ${lamportsToSell}`);
    console.log(`Expected USDC for Sell: ${expectedUSDCForSell}`);
    console.log(`USDC Lamports for Sell ${expectedUSDCForSellLamports}`);
    console.log(`Lamports to Buy: ${lamportsToBuy}`);
    console.log(`Expected USDC for Buy: ${expectedUSDCForBuy}`);
    console.log(`USDC Lamports for Buy ${expectedUSDCForBuyLamports}\n`);
	*/
	
	await jitoController("infinity");
	console.log(
		"Pause for 5 seconds to allow orders to finalize on blockchain.",
		await delay(5000)
	);
	monitor();
}

async function fetchPrice(tokenAddress) {
    const response = await axios.get(`https://price.jup.ag/v6/price?ids=${tokenAddress}`);
    const price = response.data.data[tokenAddress].price;
    return parseFloat(price);
}

async function updateUSDVal(mintAddress, balance, decimals) {
    try {
        let price = await fetchPrice(mintAddress);
        let balanceLamports = Math.floor(balance * Math.pow(10, decimals));
        const usdBalance = balanceLamports * price;
        const usdBalanceLamports =usdBalance / Math.pow(10, decimals);
        return usdBalanceLamports;
    } catch (error) {
        // Error is not critical.
        // Reuse the previous balances and try another update again next cycle.
    }
}

async function fetchNewUSDValues() {
	const tempUSDBalanceA = await updateUSDVal(
	  selectedAddressA,
	  currBalanceA,
	  selectedDecimalsA
	);
	const tempUSDBalanceB = await updateUSDVal(
	  selectedAddressB,
	  currBalanceB,
	  selectedDecimalsB
	);
  
	return {
	  currUSDBalanceA: tempUSDBalanceA ?? currUSDBalanceA,
	  currUSDBalanceB: tempUSDBalanceB ?? currUSDBalanceB,
	};
}

function calculateProfitOrLoss(currUsdTotalBalance, initUsdTotalBalance) {
	const profitOrLoss = currUsdTotalBalance - initUsdTotalBalance;
	const percentageChange = (profitOrLoss / initUsdTotalBalance) * 100;
	return { profitOrLoss, percentageChange };
}
  
function displayProfitOrLoss(profitOrLoss, percentageChange) {
	if (profitOrLoss > 0) {
	  console.log(
		`Profit : ${chalk.green(`+$${profitOrLoss.toFixed(2)} (+${percentageChange.toFixed(2)}%)`)}`
	  );
	} else if (profitOrLoss < 0) {
	  console.log(
		`Loss : ${chalk.red(`-$${Math.abs(profitOrLoss).toFixed(2)} (-${Math.abs(percentageChange).toFixed(2)}%)`)}`
	  );
	} else {
	  console.log(`Difference : $${profitOrLoss.toFixed(2)} (0.00%)`); // Neutral
	}
}

async function updatePrice() {
	let retries = 0;
	const maxRetries = 5;
    while (retries < maxRetries) {
        try {
            let newPrice = await fetchPrice(selectedAddressB);
            if(newPrice !== undefined) {
                lastKnownPrice = newPrice;
                return newPrice;
            }
        } catch (error) {
            console.error(`Fetch price failed. Attempt ${retries + 1} of ${maxRetries}`);
        }
        retries++;
    }

    if(lastKnownPrice !== null) {
        return lastKnownPrice;
    } else {
        throw new Error("Unable to fetch price and no last known price available");
    }
}

async function updateMainDisplay() {
	console.clear();
	console.log(`Jupgrid v${version}`);
	console.log(`\u{267E}  Infinity Mode`);
	console.log(`\u{1F4B0} Wallet: ${displayAddress}`);
	formatElapsedTime(startTime);
	console.log(`-`);
	console.log(
	  `\u{1F527} Settings: ${chalk.cyan(selectedTokenA)}/${chalk.magenta(selectedTokenB)}\n\u{1F3AF} ${selectedTokenB} Target Value: $${infinityTarget}\n\u{1F6A8} Stop Loss at $${stopLossUSD}\n\u{2B65} Spread: ${spread}%\n\u{1F55A} Monitor Delay: ${monitorDelay}ms`
	);
	try {
	  const { currUSDBalanceA, currUSDBalanceB } = await fetchNewUSDValues();
	  currUsdTotalBalance = currUSDBalanceA + currUSDBalanceB; // Recalculate total
	  newPrice = await updatePrice(selectedAddressB);
	} catch (error) {
	  // Error is not critical. Reuse the previous balances and try another update again next cycle.
	}
  
	if (currUsdTotalBalance < stopLossUSD) {
	  // Emergency Stop Loss
	  console.clear();
	  console.log(
		`\n\u{1F6A8} Emergency Stop Loss Triggered! - Cashing out and Exiting`
	  );
	  stopLoss = true;
	  process.kill(process.pid, "SIGINT");
	}
  
	console.log(`-
Starting Balance : $${initUsdTotalBalance.toFixed(2)}
Current Balance  : $${currUsdTotalBalance.toFixed(2)}`);
  
	const { profitOrLoss, percentageChange } = calculateProfitOrLoss(currUsdTotalBalance, initUsdTotalBalance);
	displayProfitOrLoss(profitOrLoss, percentageChange);
  
	console.log(`Market Change %: ${(((newPrice - startPrice) / startPrice) * 100).toFixed(2)}%
Market Change USD: ${(newPrice - startPrice).toFixed(9)}
Performance Delta: ${(percentageChange - ((newPrice - startPrice) / startPrice) * 100).toFixed(2)}%
-
Latest Snapshot Balance ${chalk.cyan(selectedTokenA)}: ${chalk.cyan(currBalanceA.toFixed(5))} (Change: ${chalk.cyan((currBalanceA - initBalanceA).toFixed(5))})
Latest Snapshot Balance ${chalk.magenta(selectedTokenB)}: ${chalk.magenta(currBalanceB.toFixed(5))} (Change: ${chalk.magenta((currBalanceB - initBalanceB).toFixed(5))})
-
Starting Balance A - ${chalk.cyan(selectedTokenA)}: ${chalk.cyan(initBalanceA.toFixed(5))}
Starting Balance B - ${chalk.magenta(selectedTokenB)}: ${chalk.magenta(initBalanceB.toFixed(5))}
-
Trades: ${counter}
Rebalances: ${rebalanceCounter}
-
Sell Order Price: ${newPriceBUp.toFixed(9)} - Selling ${chalk.magenta(Math.abs(infinitySellInputLamports / Math.pow(10, selectedDecimalsB)))} ${chalk.magenta(selectedTokenB)} for ${chalk.cyan(Math.abs(infinitySellOutputLamports / Math.pow(10, selectedDecimalsA)))} ${chalk.cyan(selectedTokenA)}
Current Price: ${newPrice.toFixed(9)}
Buy Order Price: ${newPriceBDown.toFixed(9)} - Buying ${chalk.magenta(Math.abs(infinityBuyOutputLamports / Math.pow(10, selectedDecimalsB)))} ${chalk.magenta(selectedTokenB)} for ${chalk.cyan(Math.abs(infinityBuyInputLamports / Math.pow(10, selectedDecimalsA)))} ${chalk.cyan(selectedTokenA)}\n`);
}

async function createTx(inAmount, outAmount, inputMint, outputMint, base) {
	if (shutDown) return;

	const maxRetries = 5;
	const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

	let attempt = 0;
	while (attempt < maxRetries) {
		attempt++;
		try {
			const tokenAccounts = await getTokenAccounts(
				connection,
				payer.publicKey,
				new solanaWeb3.PublicKey(
					"9tzZzEHsKnwFL1A3DyFJwj36KnZj3gZ7g4srWp9YTEoh"
				)
			);
			if (tokenAccounts.value.length === 0) {
				console.log(
					"No ARB token accounts found. Please purchase at least 25k ARB and try again."
				);
				process.exit(0);
			}

			const response = await fetch(
				"https://jup.ag/api/limit/v1/createOrder",
				{
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({
						owner: payer.publicKey.toString(),
						inAmount,
						outAmount,
						inputMint: inputMint.toString(),
						outputMint: outputMint.toString(),
						expiredAt: null,
						base: base.publicKey.toString(),
						//referralAccount:
						//	"7WGULgEo4Veqj6sCvA3VNxGgBf3EXJd8sW2XniBda3bJ",
						//referralName: "Jupiter GridBot"
					})
				}
			);

			if (!response.ok) {
				throw new Error(
					`Failed to create order: ${response.statusText}`
				);
			}

			const responseData = await response.json();
			const { tx: encodedTransaction } = responseData;

			// Deserialize the raw transaction
			const transactionBuf = Buffer.from(encodedTransaction, "base64");
			const transaction = solanaWeb3.Transaction.from(transactionBuf);
			transaction.sign(payer, base);
			return {
				transaction,
				orderPubkey: responseData.orderPubkey
			};

			// to be handled later
			// return { txid, orderPubkey: responseData.orderPubkey};
		} catch (error) {
			await delay(2000);
		}
	}
	// If we get here, its proper broken...
	throw new Error("Order Creation failed after maximum attempts.");
}

function encodeTransactionToBase58(transaction) {
	// Function to encode a transaction to base58
	const encodedTransaction = bs58.encode(transaction.serialize());
	return encodedTransaction;
}

async function jitoTipCheck() {
	const JitoTipWS = 'ws://bundles-api-rest.jito.wtf/api/v1/bundles/tip_stream';
	const tipws = new Websocket(JitoTipWS);
	let resolveMessagePromise;
	let rejectMessagePromise;
  
	// Create a promise that resolves with the first message received
	const messagePromise = new Promise((resolve, reject) => {
	  resolveMessagePromise = resolve;
	  rejectMessagePromise = reject;
	});
  
	// Open WebSocket connection
	tipws.on('open', function open() {
	});
  
	// Handle messages
	tipws.on('message', function incoming(data) {
	  const str = data.toString(); // Convert Buffer to string
  
	  try {
		const json = JSON.parse(str); // Parse string to JSON
		const percentile50th = json[0].landed_tips_50th_percentile; // Access the 50th percentile property
  
		if (percentile50th !== null) {
		  resolveMessagePromise(percentile50th);
		} else {
		  rejectMessagePromise(new Error('50th percentile is null'));
		}
	  } catch (err) {
		rejectMessagePromise(err);
	  }
	});
  
	// Handle errors
	tipws.on('error', function error(err) {
	  console.error('WebSocket error:', err);
	  rejectMessagePromise(err);
	});
  
	try {
	  // Wait for the first message or a timeout
	  const percentile50th = await Promise.race([
		messagePromise,
		new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 10000))
	  ]);
  
	  tipws.close(); // Close WebSocket connection
	  return percentile50th;
	} catch (err) {
	  console.error(err);
	  tipws.close(); // Close WebSocket connection
	  return 0.00005; // Return a default of 0.00005 if the request fails
	}
}

async function jitoController(task) {
	let result = "unknown";
	// Initial operation
	switch (task) {
	case "cancel":
		result = await jitoCancelOrder(task);
		break;
	case "infinity":
		result = await jitoSetInfinity(task);
		break;
	case "rebalance":
		result = await jitoRebalance(task);
		break;
	default:
		// unintended code
		console.log("Unknown Error state. Exiting...");
		process.exit(0);
	}
	jitoRetry = 1;
	// Retry loop
	while (jitoRetry < 20) {
		switch (result) {
		case "succeed":
			console.log("Operation Succeeded\n");

			jitoRetry = 21;
			break;
		case "cancelFail":
			console.log("Retrying Cancel Orders...");
			jitoRetry++;
			result = await jitoCancelOrder(task);
			break;
		case "infinityFail":
			console.log("Retrying Infinity Orders...");
			jitoRetry++;
			result = await jitoSetInfinity(task);
			break;
		case "rebalanceFail":
			console.log("Retrying Rebalance Orders...");
			jitoRetry++;
			result = await jitoRebalance(task);
			break;
		default:
			console.log("Unknown Error state. Exiting...");
			process.exit(0);
		}
	}
}

async function jitoCancelOrder(task) {
	await checkOpenOrders();
	if (checkArray.length === 0) {
		console.log("No orders found to cancel.");
		return "succeed";
	} else {
		console.log("Cancelling Orders");
		const transaction1 = await cancelOrder(checkArray, payer);
		if (transaction1 === "skip") {
			console.log("Skipping Cancel...");
			return "succeed";
		}
		const result = await handleJitoBundle(task, transaction1);
		return result;
	}
}

async function jitoSetInfinity(task) {
	// cancel any existing, place 2 new
	const base1 = Keypair.generate();
	const base2 = Keypair.generate();

	await checkOpenOrders();

	if (checkArray.length === 0) {
		console.log("No orders found to cancel.");
		const order1 = await createTx(
			infinityBuyInputLamports,
			infinityBuyOutputLamports,
			selectedAddressA,
			selectedAddressB,
			base1
		);
		const order2 = await createTx(
			infinitySellInputLamports,
			infinitySellOutputLamports,
			selectedAddressB,
			selectedAddressA,
			base2
		);
		const transaction1 = order1.transaction;
		const transaction2 = order2.transaction;
		const transactions = [transaction1, transaction2];
		const result = await handleJitoBundle(task, ...transactions);
		return result;
	} else {
		console.log("Found Orders to Cancel");
		const transaction1 = await cancelOrder(checkArray, payer);
		const order1 = await createTx(
			infinityBuyInputLamports,
			infinityBuyOutputLamports,
			selectedAddressA,
			selectedAddressB,
			base1
		);
		const order2 = await createTx(
			infinitySellInputLamports,
			infinitySellOutputLamports,
			selectedAddressB,
			selectedAddressA,
			base2
		);
		const transaction2 = order1.transaction;
		const transaction3 = order2.transaction;
		const transactions = [transaction1, transaction2, transaction3];
		const result = await handleJitoBundle(task, ...transactions);
		return result;
	}
}

async function jitoRebalance(task) {
	const transaction1 = await balanceCheck();
	if (transaction1 === "skip") {
		console.log("Skipping Rebalance...");
		return "succeed";
	}
	const result = await handleJitoBundle(task, transaction1);
	return result;
}

async function handleJitoBundle(task, ...transactions) {
	let tipValueInSol;
  try {
    tipValueInSol = await jitoTipCheck();
  } catch (err) {
    console.error(err);
    tipValueInSol = 0.00005; // Replace 0 with your default value
  }
  const tipValueInLamports = tipValueInSol * 1_000_000_000;
  const roundedTipValueInLamports = Math.round(tipValueInLamports);

	// Limit to 9 digits
	const limitedTipValueInLamports = Math.floor(
		Number(roundedTipValueInLamports.toFixed(9)) * 1.1 //+10% of tip to edge out competition
	  );
	try {
		const tipAccount = new PublicKey(getRandomTipAccount());
		const instructionsSub = [];
		const tipIxn = SystemProgram.transfer({
			fromPubkey: payer.publicKey,
			toPubkey: tipAccount,
			lamports: limitedTipValueInLamports
		});
		// console.log("Tries: ",retries);
		console.log(
			"Jito Fee:",
			limitedTipValueInLamports / Math.pow(10, 9),
			"SOL"
		);
		instructionsSub.push(tipIxn);
		const resp = await connection.getLatestBlockhash("confirmed");

		const messageSub = new TransactionMessage({
			payerKey: payer.publicKey,
			recentBlockhash: resp.blockhash,
			instructions: instructionsSub
		}).compileToV0Message();

		const txSub = new VersionedTransaction(messageSub);
		txSub.sign([payer]);
		const bundletoSend = [...transactions, txSub];

		// Ensure that bundletoSend is not empty
		if (bundletoSend.length === 0) {
			throw new Error("Bundle is empty.");
		}

		// Call sendJitoBundle with the correct bundleToSend
		const result = await sendJitoBundle(task, bundletoSend);
		return result;
	} catch (error) {
		console.error("\nBundle Construction Error: ", error);
	}
}

async function sendJitoBundle(task, bundletoSend) {
	const encodedBundle = bundletoSend.map(encodeTransactionToBase58);

	const { balanceA: preJitoA, balanceB: preJitoB } = await getBalance(
		payer,
		selectedAddressA,
		selectedAddressB,
		selectedTokenA,
		selectedTokenB
	);
	await checkOpenOrders();
	const preBundleOrders = checkArray;
	// console.log(`PreJitoA: ${preJitoA}`);
	// console.log(`PreJitoB: ${preJitoB}`);

	const data = {
		jsonrpc: "2.0",
		id: 1,
		method: "sendBundle",
		params: [encodedBundle]
	};

	let response;
	const maxRetries = 5;
	for (let i = 0; i <= maxRetries; i++) {
		try {
			response = await fetch(JitoBlockEngine, {
				method: "POST",
				headers: {
					"Content-Type": "application/json"
				},
				body: JSON.stringify(data)
			});

			if (response.ok) break; // if response is ok, we break the loop

			if (response.status === 429) {
				const waitTime = Math.min(MIN_WAIT * Math.pow(2, i), MAX_WAIT);
				const jitter = Math.random() * 0.3 * waitTime;
				await new Promise((resolve) =>
					setTimeout(resolve, waitTime + jitter)
				);
			} else {
				throw new Error("Unexpected error");
			}
		} catch (error) {
			if (i === maxRetries) {
				console.error("Max retries exceeded");
				program.exit(0);
			}
		}
	}
	const responseText = await response.text(); // Get the response body as text
	const responseData = JSON.parse(responseText); // Parse the response body as JSON

	const result = responseData.result;
	const url = `https://explorer.jito.wtf/bundle/${result}`;
	console.log(`\nResult ID: ${url}`);
	// spinner.stop();
	console.log("Checking for 30 seconds...");
	let jitoChecks = 1;
	const maxChecks = 30;
	let spinner;
	let bundleLanded = false;
	while (jitoChecks <= maxChecks) {
		spinner = ora(
			`Checking Jito Bundle Status... ${jitoChecks}/${maxChecks}`
		).start();
		console.log("\nTask: ", task);
		try {
			const { balanceA: postJitoA, balanceB: postJitoB } = await getBalance(
				payer,
				selectedAddressA,
				selectedAddressB,
				selectedTokenA,
				selectedTokenB
			);
			if (postJitoA !== preJitoA || postJitoB !== preJitoB) {
				bundleLanded = true;
				spinner.stop();
				console.log(
					"\nBundle Landed, waiting 30 seconds for orders to finalize..."
				);
				if (task !== "rebalance") {
					let bundleChecks = 1;
						while (bundleChecks <= 30) {
						let postBundleOrders
						await checkOpenOrders();
						postBundleOrders = checkArray;
						if (postBundleOrders !== preBundleOrders) {
							console.log(
								"\nBundle Landed, Orders Updated, Skipping Timer"
							);
							await delay(1000);
							jitoChecks = 31;
							break;
						} else {
							console.log(
								`Checking Orders for ${bundleChecks} of 30 seconds`
							);
							await delay(1000);
							bundleChecks++;
						}
					}
				}
				jitoChecks = 31;
				break;
			}
			jitoChecks++;
			await delay(1000);
		} catch (error) {
			console.error("Error in balance check:", error);
		}
		spinner.stop();
	}

	if (spinner) {
		spinner.stop();
	}

	await checkOpenOrders();
	switch (task) {
	case "cancel":
		if (checkArray.length > 0) {
			console.log("Cancelling Orders Failed, Retrying...");
			return "cancelFail";
		} else {
			console.log("Orders Cancelled Successfully");
			return "succeed";
		}
	case "infinity":
		if (checkArray.length !== 2) {
			console.log("Placing Infinity Orders Failed, Retrying...");
			return "infinityFail";
		} else {
			console.log("Infinity Orders Placed Successfully");
			return "succeed";
		}
	case "rebalance":
		// We dont need to check open orders here
		if (bundleLanded) {
			console.log("Rebalancing Tokens Successful");
			return "succeed";
		} else {
			console.log("Rebalancing Tokens Failed, Retrying...");
			return "rebalanceFail";
		}
	default:
		console.log("Unknown state, retrying...");
		return "unknown";
	}
}

async function rebalanceTokens(
	inputMint,
	outputMint,
	rebalanceValue,
	rebalanceSlippageBPS,
	quoteurl
) {
	if (shutDown) return;
	const rebalanceLamports = Math.floor(rebalanceValue);
	console.log(`Rebalancing Tokens ${chalk.cyan(selectedTokenA)} and ${chalk.magenta(selectedTokenB)}`);

	try {
		// Fetch the quote
		const quoteResponse = await axios.get(
			`${quoteurl}?inputMint=${inputMint}&outputMint=${outputMint}&amount=${rebalanceLamports}&autoSlippage=true&maxAutoSlippageBps=200` //slippageBps=${rebalanceSlippageBPS}
		);

		const swapApiResponse = await fetch(
			"https://quote-api.jup.ag/v6/swap",
			{
				method: "POST",
				headers: {
					"Content-Type": "application/json"
				},
				body: JSON.stringify({
					quoteResponse: quoteResponse.data,
					userPublicKey: payer.publicKey,
					wrapAndUnwrapSol: true
				})
			}
		);

		const { blockhash } = await connection.getLatestBlockhash();
		const swapData = await swapApiResponse.json();

		if (!swapData || !swapData.swapTransaction) {
			throw new Error("Swap transaction data not found.");
		}

		// Deserialize the transaction correctly for a versioned message
		const swapTransactionBuffer = Buffer.from(
			swapData.swapTransaction,
			"base64"
		);
		const transaction = VersionedTransaction.deserialize(
			swapTransactionBuffer
		);

		transaction.recentBlockhash = blockhash;
		transaction.sign([payer]);
		return transaction;
	} catch (error) {
		console.error("Error during the transaction:", error);
	}
}

async function checkOpenOrders() {
	openOrders = [];
	checkArray = [];

	// Make the JSON request
	openOrders = await limitOrder.getOrders([
		ownerFilter(payer.publicKey, "processed")
	]);

	// Create an array to hold publicKey values
	checkArray = openOrders.map((order) => order.publicKey.toString());
}

async function cancelOrder(target = [], payer) {
	const retryCount = 10;
    for (let i = 0; i < retryCount; i++) {
		/* Commented out for testing.
		if (target.length === 0) {
			console.log("No orders to cancel.");
			return "skip";
		}
		*/
		console.log(target);
    	const requestData = {
        owner: payer.publicKey.toString(),
        feePayer: payer.publicKey.toString(),
        orders: Array.from(target)
    };
        try {
            const response = await fetch("https://jup.ag/api/limit/v1/cancelOrders", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify(requestData)
            });

            if (!response.ok) {
                console.log("Bad Cancel Order Request");
                throw new Error(`HTTP error! Status: ${response.status}`);
            }

            const responseData = await response.json();
            const transactionBase64 = responseData.tx;
            const transactionBuf = Buffer.from(transactionBase64, "base64");
            const transaction = solanaWeb3.Transaction.from(transactionBuf);

            const { blockhash } = await connection.getLatestBlockhash();
            transaction.recentBlockhash = blockhash;
            transaction.sign(payer);
            return transaction;
        } catch (error) {
            if (i === retryCount - 1) throw error; // If last retry, throw error
            console.log(`Attempt ${i + 1} failed. Retrying...`);

			target = await checkOpenOrders();
        }
    }
}

async function balanceCheck() {
	console.log("Checking Portfolio, we will rebalance if necessary.");
	const currentBalances = await getBalance(
	  payer,
	  selectedAddressA,
	  selectedAddressB,
	  selectedTokenA,
	  selectedTokenB
	);
  
	currBalanceA = currentBalances.balanceA;
	currBalanceB = currentBalances.balanceB;
	currUSDBalanceA = currentBalances.usdBalanceA;
	currUSDBalanceB = currentBalances.usdBalanceB;
	currUsdTotalBalance = currUSDBalanceA + currUSDBalanceB;
	tokenARebalanceValue = currentBalances.tokenARebalanceValue;
	tokenBRebalanceValue = currentBalances.tokenBRebalanceValue;
  
	if (currUsdTotalBalance < infinityTarget) {
	  console.log(
		`Your total balance is not high enough for your Infinity Target. Please either increase your wallet balance or reduce your target.`
	  );
	  process.exit(0);
	}
	const targetUsdBalancePerToken = infinityTarget;
	const percentageDifference = Math.abs(
	  (currUSDBalanceB - targetUsdBalancePerToken) / targetUsdBalancePerToken
	);
	if (percentageDifference > 0.03) {
	  if (currUSDBalanceB < targetUsdBalancePerToken) {
		const deficit =
		  (targetUsdBalancePerToken - currUSDBalanceB) *
		  Math.pow(10, selectedDecimalsA);
		adjustmentA = Math.floor(
		  Math.abs((-1 * deficit) / tokenARebalanceValue)
		);
	  } else if (currUSDBalanceB > targetUsdBalancePerToken) {
		const surplus =
		  (currUSDBalanceB - targetUsdBalancePerToken) *
		  Math.pow(10, selectedDecimalsB);
		adjustmentB = Math.floor(
		  Math.abs(-1 * (surplus / tokenBRebalanceValue))
		);
	  }
	} else {
	  console.log("Token B $ value within 3% of target, skipping rebalance.");
	  return "skip";
	}
	const rebalanceSlippageBPS = 200;
  
	const confirmTransaction = async () => {
		if (!askForRebalance) {
			return true;
		}
		const answer = await questionAsync('Do you want to proceed with this transaction? (Y/n) ');
		if (answer.toUpperCase() === 'N') {
		  console.log('Transaction cancelled by user. Closing program.');
		  process.exit(0);
		} else {
			askForRebalance = false;
		  return true;
		}
	  };
  
	if (adjustmentA > 0) {
	  console.log(
		`Need to trade ${chalk.cyan(adjustmentA / Math.pow(10, selectedDecimalsA))} ${chalk.cyan(selectedTokenA)} to ${chalk.magenta(selectedTokenB)} to balance.`
	  );
	  const userConfirmation = await confirmTransaction();
	  if (userConfirmation) {
		const rebalanceTx = await rebalanceTokens(
		  selectedAddressA,
		  selectedAddressB,
		  adjustmentA,
		  rebalanceSlippageBPS,
		  quoteurl
		);
		return rebalanceTx;
	  } else {
		console.log('Transaction cancelled by user.');
		return;
	  }
	} else if (adjustmentB > 0) {
	  console.log(
		`Need to trade ${chalk.magenta(adjustmentB / Math.pow(10, selectedDecimalsB))} ${chalk.magenta(selectedTokenB)} to ${chalk.cyan(selectedTokenA)} to balance.`
	  );
	  const userConfirmation = await confirmTransaction();
	  if (userConfirmation) {
		const rebalanceTx = await rebalanceTokens(
		  selectedAddressB,
		  selectedAddressA,
		  adjustmentB,
		  rebalanceSlippageBPS,
		  quoteurl
		);
		return rebalanceTx;
	  } else {
		console.log('Transaction cancelled by user.');
		return;
	  }
	}
}

process.on("SIGINT", () => {
	console.log("\nCTRL+C detected! Performing cleanup...");
	shutDown = true;
	(async () => {
		await jitoController("cancel");
		process.exit(0);
	})();
});

export { connection, initialize };
