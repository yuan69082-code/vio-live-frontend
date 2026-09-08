import { ValidationError } from '../../core/errors.js';
import { canonicalizeJson } from '../../core/canonical-json.js';

const DRAFT='https://json-schema.org/draft/2020-12/schema';
const TYPES=new Set(['object','array','string','number','integer','boolean','null']);
const KEYWORDS=new Set(['$schema','type','properties','required','additionalProperties','items','enum','const','description','title','minLength','maxLength','minimum','maximum','minItems','maxItems','pattern','x-mcp-header']);

function fail(message,field,details={}) {throw new ValidationError(message,{field,...details});}
function plain(value,field) {
  if(value===null||typeof value!=='object'||Array.isArray(value)||![Object.prototype,null].includes(Object.getPrototypeOf(value)))fail(`${field} must be a plain JSON object.`,field);
  const descriptors=Object.getOwnPropertyDescriptors(value);
  for(const key of Reflect.ownKeys(value))if(typeof key!=='string'||descriptors[key]?.enumerable!==true||!Object.hasOwn(descriptors[key],'value'))fail(`${field} must contain ordinary enumerable JSON fields.`,field);
  return value;
}
export function requireStrictJson(value,field='value',{maxBytes=65_536}={}) {
  const seen=new Set();
  function visit(item,path) {
    if(item===null||typeof item==='string'||typeof item==='boolean')return;
    if(typeof item==='number'){if(!Number.isFinite(item))fail(`${path} must be a finite JSON number.`,path);return;}
    if(typeof item!=='object')fail(`${path} must contain JSON-compatible values.`,path);
    if(seen.has(item))fail(`${path} must not contain cycles.`,path);seen.add(item);
    try{
      if(Array.isArray(item)){
        const allowed=new Set(['length',...Array.from({length:item.length},(_,index)=>String(index))]);
        if(Reflect.ownKeys(item).some(key=>typeof key!=='string'||!allowed.has(key)))fail(`${path} must not contain non-item array properties.`,path);
        for(let index=0;index<item.length;index+=1){if(!Object.hasOwn(item,index))fail(`${path} must not be sparse.`,`${path}[${index}]`);visit(item[index],`${path}[${index}]`);}return;
      }
      plain(item,path);for(const key of Object.keys(item))visit(item[key],`${path}.${key}`);
    }finally{seen.delete(item);}
  }
  visit(value,field);const bytes=canonicalizeJson(value);if(bytes.length>maxBytes)fail(`${field} exceeds its JSON byte boundary.`,field,{maxBytes});return value;
}

function requireIntegerKeyword(value,field) {if(!Number.isSafeInteger(value)||value<0)fail(`${field} must be a non-negative safe integer.`,field);return value;}
function inspectSchema(value,field,headers,path=[],headerReachable=true) {
  const schema=plain(value,field);requireStrictJson(schema,field);
  const unknown=Object.keys(schema).filter(key=>!KEYWORDS.has(key));if(unknown.length)fail(`${field} contains unsupported JSON Schema keywords.`,field,{unknownFields:unknown});
  if(schema.$schema!==undefined&&schema.$schema!==DRAFT)fail(`${field} must use JSON Schema 2020-12.`,`${field}.$schema`);
  if(typeof schema.type!=='string'||!TYPES.has(schema.type))fail(`${field}.type is required and unsupported.`,`${field}.type`);
  if(schema.description!==undefined&&(typeof schema.description!=='string'||[...schema.description].length>2000))fail(`${field}.description is invalid.`,`${field}.description`);
  if(schema.title!==undefined&&(typeof schema.title!=='string'||[...schema.title].length>200))fail(`${field}.title is invalid.`,`${field}.title`);
  if(schema.enum!==undefined){if(!Array.isArray(schema.enum)||schema.enum.length<1||schema.enum.length>100)fail(`${field}.enum is invalid.`,`${field}.enum`);for(const item of schema.enum)requireStrictJson(item,`${field}.enum`);}
  for(const key of ['minLength','maxLength','minItems','maxItems'])if(schema[key]!==undefined)requireIntegerKeyword(schema[key],`${field}.${key}`);
  for(const key of ['minimum','maximum'])if(schema[key]!==undefined&&(typeof schema[key]!=='number'||!Number.isFinite(schema[key])))fail(`${field}.${key} must be finite.`,`${field}.${key}`);
  if(schema.pattern!==undefined){if(typeof schema.pattern!=='string'||schema.pattern.length>512)fail(`${field}.pattern is invalid.`,`${field}.pattern`);try{new RegExp(schema.pattern,'u');}catch{fail(`${field}.pattern is invalid.`,`${field}.pattern`);}}
  if(schema['x-mcp-header']!==undefined){
    const name=schema['x-mcp-header'];if(!headerReachable||!path.length||!['string','integer','boolean'].includes(schema.type)||typeof name!=='string'||!/^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/.test(name))fail(`${field}.x-mcp-header is invalid.`,`${field}.x-mcp-header`);
    const folded=name.toLowerCase();if(headers.some(item=>item.name.toLowerCase()===folded))fail(`${field}.x-mcp-header must be unique.`,`${field}.x-mcp-header`);headers.push({name,path:[...path],type:schema.type});
  }
  if(schema.type==='object'){
    if(schema.properties!==undefined){const props=plain(schema.properties,`${field}.properties`);if(Object.keys(props).length>100)fail(`${field}.properties has too many fields.`,`${field}.properties`);for(const [name,child] of Object.entries(props)){if(!name||name.length>128)fail(`${field}.properties contains an invalid name.`,`${field}.properties`);inspectSchema(child,`${field}.properties.${name}`,headers,[...path,name],headerReachable);}}
    if(schema.required!==undefined){if(!Array.isArray(schema.required)||new Set(schema.required).size!==schema.required.length||schema.required.some(item=>typeof item!=='string'||!Object.hasOwn(schema.properties??{},item)))fail(`${field}.required is invalid.`,`${field}.required`);}
    if(schema.additionalProperties!==undefined&&typeof schema.additionalProperties!=='boolean')fail(`${field}.additionalProperties must be boolean.`,`${field}.additionalProperties`);
  } else if(schema.properties!==undefined||schema.required!==undefined||schema.additionalProperties!==undefined)fail(`${field} uses object keywords for a non-object.`,field);
  if(schema.type==='array') {if(schema.items===undefined)fail(`${field}.items is required.`,`${field}.items`);inspectSchema(schema.items,`${field}.items`,headers,[],false);} else if(schema.items!==undefined||schema.minItems!==undefined||schema.maxItems!==undefined)fail(`${field} uses array keywords for a non-array.`,field);
  return schema;
}
export function inspectJsonSchema2020(value,field='schema') {const headers=[];const schema=inspectSchema(value,field,headers);return Object.freeze({schema,headers:Object.freeze(headers.map(item=>Object.freeze(item)))});}

function equal(left,right) {return canonicalizeJson(left).equals(canonicalizeJson(right));}
function typeMatches(value,type) {if(type==='null')return value===null;if(type==='array')return Array.isArray(value);if(type==='object')return value!==null&&typeof value==='object'&&!Array.isArray(value)&&[Object.prototype,null].includes(Object.getPrototypeOf(value));if(type==='integer')return Number.isSafeInteger(value);return typeof value===type;}
export function validateJsonSchemaValue(schema,value,field='input') {
  requireStrictJson(value,field);
  function validate(rule,item,path) {
    if(!typeMatches(item,rule.type))fail(`${path} does not match schema type ${rule.type}.`,path);
    if(rule.const!==undefined&&!equal(rule.const,item))fail(`${path} does not match schema const.`,path);
    if(rule.enum!==undefined&&!rule.enum.some(choice=>equal(choice,item)))fail(`${path} does not match schema enum.`,path);
    if(typeof item==='string'){
      const length=[...item].length;if(rule.minLength!==undefined&&length<rule.minLength)fail(`${path} is too short.`,path);if(rule.maxLength!==undefined&&length>rule.maxLength)fail(`${path} is too long.`,path);if(rule.pattern!==undefined&&!new RegExp(rule.pattern,'u').test(item))fail(`${path} does not match schema pattern.`,path);
    }
    if(typeof item==='number'){if(rule.minimum!==undefined&&item<rule.minimum)fail(`${path} is below schema minimum.`,path);if(rule.maximum!==undefined&&item>rule.maximum)fail(`${path} exceeds schema maximum.`,path);}
    if(Array.isArray(item)){if(rule.minItems!==undefined&&item.length<rule.minItems)fail(`${path} has too few items.`,path);if(rule.maxItems!==undefined&&item.length>rule.maxItems)fail(`${path} has too many items.`,path);for(let i=0;i<item.length;i+=1)validate(rule.items,item[i],`${path}[${i}]`);}
    if(item!==null&&typeof item==='object'&&!Array.isArray(item)){
      for(const name of rule.required??[])if(!Object.hasOwn(item,name))fail(`${path}.${name} is required.`,`${path}.${name}`);
      const properties=rule.properties??{};for(const [name,child] of Object.entries(item)){if(Object.hasOwn(properties,name))validate(properties[name],child,`${path}.${name}`);else if(rule.additionalProperties===false)fail(`${path}.${name} is not allowed.`,`${path}.${name}`);}
    }
  }
  validate(schema,value,field);return value;
}

export function mcpHeaderValues(headers,input) {
  return headers.flatMap(header=>{let value=input;for(const name of header.path){if(value===null||typeof value!=='object'||!Object.hasOwn(value,name))return [];value=value[name];}if(value===null||value===undefined)return [];if(!typeMatches(value,header.type))fail('MCP header value does not match its schema.','input');const raw=String(value);const plainAscii=/^[\x20-\x7e]+$/.test(raw)&&raw.trim()===raw&&!/^=\?base64\?.*\?=$/.test(raw);return [[`Mcp-Param-${header.name}`,plainAscii?raw:`=?base64?${Buffer.from(raw,'utf8').toString('base64')}?=`]];});
}
