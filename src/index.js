// TODO(psq):
// mainnet/testnet
// generate 12/generate 24/provide 12/provide 24

const crypto = require('crypto')
const randombytes = require('randombytes')
const bip39 = require('bip39')
const bitcoin = require('bitcoinjs-lib')
const stacks_transactions = require('@stacks/transactions')
const c32c = require('c32check')
const wif = require('wif')
const yargs = require('yargs')

const { generateMnemonic, mnemonicToSeed } = bip39
const { bip32, networks, ECPair } = bitcoin
const { ChainID, getAddressFromPrivateKey, TransactionVersion } = stacks_transactions

function privateKeyToWIF(private_key_hex, mainnet) {
  return wif.encode(mainnet ? 0x80 : 0xEF, Buffer.from(private_key_hex, 'hex'), true)
}

function ecPairToHexString(secretKey) {
    const ecPointHex = secretKey.privateKey.toString('hex')
    if (secretKey.compressed) {
        return `${ecPointHex}01`
    }
    else {
        return ecPointHex
    }
}

function deriveStxAddressChain(chain, derivationPath) {
  return (rootNode) => {
    const childKey = rootNode.derivePath(derivationPath)
    if (!childKey.privateKey) {
      throw new Error('Unable to derive private key from `rootNode`, bip32 master keychain')
    }
    const txVersion = (chain === ChainID.Mainnet) ? TransactionVersion.Mainnet : TransactionVersion.Testnet
    const ecPair = ECPair.fromPrivateKey(childKey.privateKey)
    const privateKey = ecPairToHexString(ecPair)
    return {
      childKey,
      address: getAddressFromPrivateKey(privateKey, txVersion),
      publicKey: ecPair.publicKey,
      privateKey,
      ecPair,
    }
  }
}

function sha256(data) {
  let hash = crypto.createHash('sha256')
  hash.update(data)
  return hash.digest()
}

function ripemd160(data) {
  let hash = crypto.createHash('ripemd160')
  hash.update(data)
  return hash.digest()
}

function hash160(data) {
  return ripemd160(sha256(data))
}

async function generateKeys(seed_phrase, mainnet, derivationPath) {
  const seedBuffer = await mnemonicToSeed(seed_phrase)
  const masterKeychain = bip32.fromSeed(seedBuffer)
  const keys = deriveStxAddressChain(mainnet ? ChainID.Mainnet : ChainID.Testnet, derivationPath)(masterKeychain)

  const uncompressed_hex = bitcoin.ECPair.fromPublicKey(
    Buffer.from(keys.publicKey, 'hex'),
    { compressed: false },
  ).publicKey.toString('hex')


  return {
    phrase: seed_phrase,
    private: keys.privateKey,
    public: keys.publicKey.toString('hex'),
    public_uncompressed: uncompressed_hex,
    stacks: keys.address,
    stacking: `{ hashbytes: 0x${c32c.c32addressDecode(keys.address)[1]}, version: 0x00 }`,
    btc: c32c.c32ToB58(keys.address),
    wif: privateKeyToWIF(keys.privateKey, mainnet),
    derivationPath: derivationPath
  }
}

yargs
  .scriptName("stacks-gen")
  .usage('$0 <cmd> [args]')
  .option('phrase', {
    alias: 'p',
    describe: 'Provide the secret phrase to use',
  })
  .option('testnet', {
    alias: 't',
    describe: 'Generate for testnet instead of mainnet',
  })
  .option('key', {
    alias: 'k',
    describe: 'The public key to uncompress',
  })
  .option('words', {
    alias: 'w',
    default: 24,
    describe: 'Use 24 or 12 secret phrase',
  })
  .option('path', {
    alias: 'd',
    describe: 'The derivation path for network, e.g. "m/44\'/5757\'/0\'/0/0"',
    type: 'string',
  })
  .option('account', {
    alias: 'a',
    describe: 'Specify the account number for the derivation path',
    type: 'number',
  })
  .choices('w', [12, 24])
  .command('sk', 'Generate keys for Stacks 2.0', (yargs) => {
    yargs.positional('sk', {
      type: 'string',
      describe: 'Generate keys for mainnet or testnet'
    })
  }, async function (argv) {
    const mainnet = !argv.testnet
    const entropy = argv.words === 24 ? 256 : 128
    const phrase = argv.phrase || generateMnemonic(entropy, randombytes)
    // console.log('generate', phrase, argv.testnet)

    let derivationPath;
    if (argv.path && argv.account) {
      console.error('Error: Only one of --path or --account can be used, not both.');
      process.exit(1);
    } else if (argv.path) {
      derivationPath = argv.path;
    } else if (argv.account) {
      derivationPath = `m/44'/5757'/${argv.account}'/0/0`;
    } else {
      derivationPath = `m/44'/5757'/0'/0/0`; // default derivation path
    }

    console.log(JSON.stringify(await generateKeys(phrase, mainnet, derivationPath), null, 2))
  })
  .command('pk <key>', 'Generate keys for Stacks 2.0 from private key', (yargs) => {
    yargs.positional('key', {
      type: 'string',
      describe: 'Generate keys for mainnet or testnet from private key'
    })
  }, async function (argv) {
    const mainnet = !argv.testnet
    // console.log('generate from private key', argv.key, argv.testnet)

    const ec_pair_compressed = ECPair.fromPrivateKey(Buffer.from(argv.key, 'hex').slice(0, 32), { compressed: true })
    const ec_pair_uncompressed = ECPair.fromPrivateKey(Buffer.from(argv.key, 'hex').slice(0, 32), { compressed: false })
    // console.log("ec_pair", ec_pair, ec_pair.publicKey.toString('hex'))

    const txVersion = mainnet ? TransactionVersion.Mainnet : TransactionVersion.Testnet
    const address = getAddressFromPrivateKey(argv.key, txVersion)

    console.log(JSON.stringify({
      private_key: argv.key,
      publick_key_compressed: ec_pair_compressed.publicKey.toString('hex'),
      publick_key_uncompressed: ec_pair_uncompressed.publicKey.toString('hex'),
      stacks: address,
      stacking: `{ hashbytes: 0x${c32c.c32addressDecode(address)[1]}, version: 0x00 }`,
      btc: c32c.c32ToB58(address),
      wif: privateKeyToWIF(ec_pair_compressed.privateKey, mainnet),
    }, null, 2))
  })
  .command('uncompress_pubpkey', 'Uncompress a public key', (yargs) => {
    yargs.positional('uncompress_pubpkey', {
      type: 'string',
      describe: 'Uncompress a public key'
    })
  }, async function (argv) {
    console.log('Public key:', argv.key)

    const uncompressed_hex = bitcoin.ECPair.fromPublicKey(
      Buffer.from(argv.key, 'hex'),
      { compressed: false },
    ).publicKey.toString('hex')
    console.log('Public key - uncompressed:', uncompressed_hex)
  })
  .demandCommand(1, 'You need at least one command')
  .requiresArg('w')
  .requiresArg('p')
  .requiresArg('d')
  .requiresArg('a')
  .strictCommands(true)
  .strictOptions(true)
  .help()
  .argv
