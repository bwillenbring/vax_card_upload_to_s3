# vax_card_upload_to_s3
Uses textract and rekognition to run basic text and object heuristics on s3 images.

![term-window](https://user-images.githubusercontent.com/513367/128778090-f9f361ed-fad4-49d4-a32c-6dd36a0cc004.png)


## Prerequisites to use this repo
- You have an aws account 
- You have an IAM role with the following:
  - `awsAccesskeyID`
  - `awsSecretAccessKey`
- You have created an s3 bucket
- You have uploaded 1 or more test files (pdf, jpg, or png) into that bucket 

## To use this repo, do the following:
1. Run `npm install` at the root of the directory
2. Open `config.modify.js` and supply valid values for the 3 keys in module.exports
3. Save `config.modify.js` as `config.js`
4. Open `index.js` and modify 2 values:
  - `bucket`
  - `photo`
5. Run `node index.js` 

### Expected result
This is what you might see if you were to upload a picture of a cat into the bucket.
```
{
  "Patient Name": "",
  "Patient Number": null,
  "Vaccine Provider": "",
  "Document Structure Detected In Image": {},
  "Image is Card-like": false,
  "Objects Detected In Image": [
    "Wood",
    "Cat",
    "Mammal",
    "Pet",
    "Animal",
    "Hardwood",
    "Plywood",
    "Flooring",
    "Floor",
    "Manx",
    "Black Cat"
  ]
}
```
