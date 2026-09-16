package main

import (
 "bytes"
 "encoding/hex"
 "encoding/json"
 "fmt"
 "io"
 "os"
 "github.com/btcsuite/btcd/txscript"
 "github.com/btcsuite/btcd/wire"
)

type PreviousOutput struct { Txid string `json:"txid"`; Vout uint32 `json:"vout"`; Script string `json:"script_hex"`; Amount *int64 `json:"amount_sats"` }
type TransactionContext struct { Hex string `json:"transaction_hex"`; Script string `json:"previous_script_hex,omitempty"`; Amount int64 `json:"previous_amount_sats,omitempty"`; InputIndex int `json:"input_index,omitempty"`; PreviousOutputs []PreviousOutput `json:"previous_outputs,omitempty"` }
type TransactionVerdict struct { Valid bool `json:"script_valid"`; Error string `json:"error,omitempty"` }

func verifyTransaction(context TransactionContext) (TransactionVerdict,error) {
 raw,err:=hex.DecodeString(context.Hex);if err!=nil||len(raw)>400000{return TransactionVerdict{},fmt.Errorf("invalid transaction bytes")}
 var tx wire.MsgTx;reader:=bytes.NewReader(raw);if err=tx.Deserialize(reader);err!=nil||reader.Len()!=0||len(tx.TxIn)==0||len(tx.TxIn)>256||context.InputIndex<0||context.InputIndex>=len(tx.TxIn){return TransactionVerdict{},fmt.Errorf("invalid canonical transaction or selected input")}
 fetcher:=txscript.NewMultiPrevOutFetcher(nil)
 var previous []byte;var amount int64
 if len(context.PreviousOutputs)>0 {
  if len(context.PreviousOutputs)!=len(tx.TxIn)||context.Script!=""||context.Amount!=0{return TransactionVerdict{},fmt.Errorf("provide one unambiguous previous output per input")}
  seen:=make(map[wire.OutPoint]bool);var total int64
  for index,output:=range context.PreviousOutputs {
   point:=tx.TxIn[index].PreviousOutPoint
   if output.Txid!=point.Hash.String()||output.Vout!=point.Index||seen[point]||output.Amount==nil||*output.Amount<0||*output.Amount>2100000000000000{return TransactionVerdict{},fmt.Errorf("previous output binding or amount mismatch")}
   seen[point]=true;total+=*output.Amount;if total>2100000000000000{return TransactionVerdict{},fmt.Errorf("input total outside monetary bound")}
   script,e:=hex.DecodeString(output.Script);if e!=nil||len(script)>10000{return TransactionVerdict{},fmt.Errorf("invalid previous output script")}
   fetcher.AddPrevOut(point,&wire.TxOut{Value:*output.Amount,PkScript:script})
   if index==context.InputIndex{previous=script;amount=*output.Amount}
  }
 } else {
  if len(tx.TxIn)!=1||context.InputIndex!=0{return TransactionVerdict{},fmt.Errorf("multi-input verification requires every bound previous output")}
  previous,err=hex.DecodeString(context.Script);amount=context.Amount
  if err!=nil||len(previous)>10000||amount<0||amount>2100000000000000{return TransactionVerdict{},fmt.Errorf("invalid previous output")}
  fetcher.AddPrevOut(tx.TxIn[0].PreviousOutPoint,&wire.TxOut{Value:amount,PkScript:previous})
 }
 hashes:=txscript.NewTxSigHashes(&tx,fetcher)
 engine,err:=txscript.NewEngine(previous,&tx,context.InputIndex,txscript.StandardVerifyFlags,nil,hashes,amount,fetcher)
 if err!=nil{return TransactionVerdict{false,err.Error()},nil}
 if err=engine.Execute();err!=nil{return TransactionVerdict{false,err.Error()},nil}
 return TransactionVerdict{Valid:true},nil
}

func transactionMain() {
 var request struct { Transactions []TransactionContext `json:"transactions"` }
 decoder:=json.NewDecoder(io.LimitReader(os.Stdin,2_100_001));decoder.DisallowUnknownFields()
 if err:=decoder.Decode(&request);err!=nil||len(request.Transactions)==0||len(request.Transactions)>512 {fmt.Println(`{"error":"invalid transaction contexts"}`);os.Exit(2)}
 verdicts:=make([]TransactionVerdict,0,len(request.Transactions))
 for _,context:=range request.Transactions { verdict,err:=verifyTransaction(context);if err!=nil {json.NewEncoder(os.Stdout).Encode(map[string]string{"error":err.Error()});os.Exit(2)};verdicts=append(verdicts,verdict) }
 json.NewEncoder(os.Stdout).Encode(map[string]interface{}{"engine":"btcd txscript 1c55c7c18179","results":verdicts,"scope":"Selected-input transaction script execution with all bound previous outputs and btcd StandardVerifyFlags. Does not establish chain maturity, unspentness, whole-transaction policy or relay acceptance."})
}
