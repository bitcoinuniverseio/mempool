package main

import (
 "bytes"
 "encoding/hex"
 "testing"
 "github.com/btcsuite/btcd/wire"
)

func contextFixture(script string) TransactionContext {
 tx:=wire.NewMsgTx(2);tx.AddTxIn(&wire.TxIn{Sequence:wire.MaxTxInSequenceNum});tx.AddTxOut(&wire.TxOut{Value:900,PkScript:[]byte{0x51}})
 var buffer bytes.Buffer;tx.Serialize(&buffer)
 return TransactionContext{Hex:hex.EncodeToString(buffer.Bytes()),Script:script,Amount:1000}
}
func TestTransactionScriptValidAndFalse(t *testing.T) {
 valid,err:=verifyTransaction(contextFixture("51"));if err!=nil||!valid.Valid{t.Fatalf("valid script rejected: %v %v",valid,err)}
 invalid,err:=verifyTransaction(contextFixture("00"));if err!=nil||invalid.Valid||invalid.Error==""{t.Fatalf("false script not rejected: %v %v",invalid,err)}
}
func TestTransactionContextRequiresCanonicalBytes(t *testing.T) {
 context:=contextFixture("51");context.Hex+="00";if _,err:=verifyTransaction(context);err==nil{t.Fatal("trailing bytes accepted")}
}
func TestSelectedInputRequiresEveryBoundPreviousOutput(t *testing.T) {
 tx:=wire.NewMsgTx(2);tx.AddTxIn(&wire.TxIn{Sequence:wire.MaxTxInSequenceNum});second:=wire.OutPoint{};second.Hash[0]=1
 tx.AddTxIn(&wire.TxIn{PreviousOutPoint:second,Sequence:wire.MaxTxInSequenceNum});tx.AddTxOut(&wire.TxOut{Value:1900,PkScript:[]byte{0x51}})
 var buffer bytes.Buffer;tx.Serialize(&buffer);amount:=int64(1000)
 context:=TransactionContext{Hex:hex.EncodeToString(buffer.Bytes()),InputIndex:1,PreviousOutputs:[]PreviousOutput{
  {Txid:tx.TxIn[0].PreviousOutPoint.Hash.String(),Vout:0,Script:"00",Amount:&amount},
  {Txid:second.Hash.String(),Vout:0,Script:"51",Amount:&amount},
 }}
 valid,err:=verifyTransaction(context);if err!=nil||!valid.Valid{t.Fatalf("selected valid input failed: %v %v",valid,err)}
 context.InputIndex=0;invalid,err:=verifyTransaction(context);if err!=nil||invalid.Valid{t.Fatalf("selected false input passed: %v %v",invalid,err)}
 context.PreviousOutputs[1].Txid=tx.TxIn[0].PreviousOutPoint.Hash.String();if _,err:=verifyTransaction(context);err==nil{t.Fatal("wrong previous-output binding accepted")}
 context.PreviousOutputs=context.PreviousOutputs[:1];if _,err:=verifyTransaction(context);err==nil{t.Fatal("missing previous output accepted")}
}
