const aws = require('aws-sdk')
const _ = require('lodash')
const config = require('./config')
const sep = '-'.repeat(75)

// Pass in valid awsRegion + IAM credentials so the api call works and the S3 bucket can be read
aws.config.update({
  accessKeyId: config.awsAccesskeyID,
  secretAccessKey: config.awsSecretAccessKey,
  region: config.awsRegion
})

// Modify these 2 values to suit your needs
const bucket = 'vax-card-uploads' // the bucketname without s3://
const photo = 'vax_card_cat.jpg' // the name of the file object

// Default params for both api calls
const default_params = {
  Document: {
    S3Object: {
      Bucket: bucket,
      Name: photo
    }
  }
}

// The image MUST contain 1 or more of the following object types
const expected_objects = [
  'Id Cards',
  'Document',
  'Paper',
  'Driving License',
  'License',
  'Postcard'
]
// The card MUST contain all of the following text fragments
const expected_phrases = [
  'covid',
  'cdc',
  'vaccine',
  'lot number',
  '1st dose',
  '2nd dose'
]
// The card MUST contain ONE of the following...
const vaccine_providers = [
  'pfizer',
  'moderna',
  'johnson & johnson',
  'johnson and johnson',
  'janssen',
  'astra zeneca'
]
// Make regex to test for presence of 1 or more vaccine providers
const provider_regex = eval(
  `/(${vaccine_providers.join('|').replace('&', '&')})/gi`
)

// The structure of the card's key-value map must contain these keys
const required_pii = ['date of birth', 'first name', 'last name']

// Instantiate aws textract and rekognition
const [textract, rek] = [new aws.Textract(), new aws.Rekognition()]

// Function to validate the scanned image
async function validateCard (blocks) {
  const { keyMap, valueMap, blockMap } = getKeyValueMap(blocks)
  const keyValues = getKeyValueRelationship(keyMap, valueMap, blockMap)
  const keys = Object.keys(keyValues).map(k => k.toLowerCase().trim())
  const lines_found = blocks
    .filter(b => b.BlockType === 'LINE' && b.Text.length >= 3)
    .map(b => b.Text.toLowerCase())
  let total_text = Array.from(new Set(lines_found)).join(' ')
  const objects_in_image = await detectObjects()
  const found_objects = _.intersection(objects_in_image, expected_objects)
  const [p_name, p_number, vax_provider, is_card_like] = [
    getPatientName(keyValues),
    getPatientNumber(keyValues),
    getVaccineProvider(lines_found),
    found_objects.length > 0
  ]

  const patient = {
    'Patient Name': p_name,
    'Patient Number': p_number,
    'Vaccine Provider': vax_provider,
    'Document Structure Detected In Image': keyValues,
    'Image is Card-like': is_card_like,
    'Objects Detected In Image': objects_in_image
  }
  // ---------------------------------------------------------------------------
  // BEGIN ASSERTIONS
  // ---------------------------------------------------------------------------
  let assertions = []
  let [assertion1, assertion2, assertion3, assertion4] = [
    false,
    false,
    false,
    false
  ]
  console.log(JSON.stringify(patient, undefined, 2) + '\n' + sep)
  console.log(`Text appearing on image...\n${total_text}\n${sep}`)

  // 1. Assert that there's a patient name and a vaccine provider
  assertions.push(p_name.length > 4 && vax_provider.length > 4)

  // 2. Assert that all required personally identifiable info appears in the key-value map
  assertions.push(
    _.intersection(keys, required_pii).length === required_pii.length
  )

  // 3. Assert that each expected phrase appears in the card at least once
  let phrases_found = 0
  for (p of expected_phrases) {
    let r = eval(`/${p}/`)
    if (r.test(total_text)) phrases_found++
  }
  assertions.push(phrases_found >= expected_phrases.length)

  // 4. Assert that at least ONE of the vaccine providers appears on the card
  assertions.push(provider_regex.test(total_text))

  // 5. Assert that the image is something like a card. Use aws rekognition
  assertions.push(is_card_like)

  // TODO: 6. Assert there are 2 VALID vaccine lot #'s against https://vaccinecodeset.cdc.gov/LotNumber
  // ---------------------------------------------------------------------------
  // END ASSERTIONS
  // ---------------------------------------------------------------------------

  return assertions.filter(a => a !== true).length === 0
}

function getText (result, blocksMap) {
  let text = ''
  if (_.has(result, 'Relationships')) {
    result.Relationships.forEach(relationship => {
      if (relationship.Type === 'CHILD') {
        relationship.Ids.forEach(childId => {
          const word = blocksMap[childId]
          if (word.BlockType === 'WORD') {
            text += `${word.Text} `
          }
          if (word.BlockType === 'SELECTION_ELEMENT') {
            if (word.SelectionStatus === 'SELECTED') {
              text += `X `
            }
          }
        })
      }
    })
  }
  return text.trim()
}

function findValueBlock (keyBlock, valueMap) {
  let valueBlock
  keyBlock.Relationships.forEach(relationship => {
    if (relationship.Type === 'VALUE') {
      // eslint-disable-next-line array-callback-return
      relationship.Ids.every(valueId => {
        if (_.has(valueMap, valueId)) {
          valueBlock = valueMap[valueId]
          return false
        }
      })
    }
  })
  return valueBlock
}

function getKeyValueRelationship (keyMap, valueMap, blockMap) {
  const keyValues = {}
  const keyMapValues = _.values(keyMap)

  keyMapValues.forEach(keyMapValue => {
    const valueBlock = findValueBlock(keyMapValue, valueMap)
    const key = getText(keyMapValue, blockMap)
    const value = getText(valueBlock, blockMap)
    keyValues[key] = value
  })
  return keyValues
}

function getKeyValueMap (blocks) {
  const keyMap = {}
  const valueMap = {}
  const blockMap = {}

  let blockId
  blocks.forEach(block => {
    blockId = block.Id
    blockMap[blockId] = block

    if (block.BlockType === 'KEY_VALUE_SET') {
      if (_.includes(block.EntityTypes, 'KEY')) {
        keyMap[blockId] = block
      } else {
        valueMap[blockId] = block
      }
    }
  })

  return { keyMap, valueMap, blockMap }
}

function getPatientNumber (keyValues, lines_found) {
  let num = null
  for (k in keyValues) {
    if (
      k
        .trim()
        .toLowerCase()
        .startsWith('patient number')
    ) {
      // Always return a string
      num = String(keyValues[k]).trim()
    }
  }
  return num
}

function getPatientName (keyValues) {
  let [first, last] = ['', '']
  for (k in keyValues) {
    if (
      k
        .trim()
        .toLowerCase()
        .startsWith('first name')
    ) {
      first = String(keyValues[k]).trim()
    } else if (
      k
        .trim()
        .toLowerCase()
        .startsWith('last name')
    ) {
      last = String(keyValues[k]).trim()
    } else {
      continue
    }
  }
  return `${first} ${last}`.trim()
}

function getVaccineProvider (lines_found) {
  // Filter down the array of lines of text found within the image, testing the regex along the way
  let p = lines_found.filter(l => {
    if (provider_regex.test(l)) return l
  })
  // Title case it
  return _.startCase(_.toLower(p))
}

async function detectObjects () {
  const params = JSON.parse(JSON.stringify(default_params))
  params.Image = params.Document
  delete params.Document
  let request = rek.detectLabels(params)
  const labels = await request.promise()
  // We only want the label names
  return labels.Labels.map(l => l.Name)
}

// Call analyzeDocument with an anonymous async IIFE
;(async function doTextract () {
  // Copy params from default params and add 1 property
  const params = JSON.parse(JSON.stringify(default_params))
  params.FeatureTypes = ['FORMS']
  // Make the request to analyze the document and await the response
  const data = await (textract.analyzeDocument(params)).promise()
  // Is it a valid cdc card? true || false
  let status = await validateCard(data.Blocks) === true ? `✅` : `🚫`
  // Print it...
  console.log(status)
})()
