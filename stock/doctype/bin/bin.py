# ERPNext - web based ERP (http://erpnext.com)
# Copyright (C) 2012 Web Notes Technologies Pvt Ltd
# 
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU General Public License as published by
# the Free Software Foundation, either version 3 of the License, or
# (at your option) any later version.
# 
# This program is distributed in the hope that it will be useful,
# but WITHOUT ANY WARRANTY; without even the implied warranty of
# MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
# GNU General Public License for more details.
# 
# You should have received a copy of the GNU General Public License
# along with this program.  If not, see <http://www.gnu.org/licenses/>.

from __future__ import unicode_literals
import webnotes

from webnotes.utils import add_days, cint, cstr, flt, get_defaults, now, nowdate
from webnotes.model import db_exists
from webnotes.model.doc import Document, addchild
from webnotes.model.wrapper import copy_doclist
from webnotes.model.code import get_obj
from webnotes import msgprint
sql = webnotes.conn.sql


class DocType:	
	def __init__(self, doc, doclist=[]):
		self.doc = doc
		self.doclist = doclist
		
	def update_stock(self, args):
		if not args.get("posting_date"):
			posting_date = nowdate()
			
		self.update_qty(args)
		
		if (flt(args.get("actual_qty")) < 0 or flt(args.get("reserved_qty")) > 0) \
				and args.get("is_cancelled") == 'No' and args.get("is_amended")=='No':
			self.reorder_item(args.get("voucher_type"), args.get("voucher_no"))
		
		if args.get("actual_qty"):
			# update valuation and qty after transaction for post dated entry
			self.update_entries_after(args.get("posting_date"), args.get("posting_time"))
		
	def update_qty(self, args):
		# update the stock values (for current quantities)
		self.doc.actual_qty = flt(self.doc.actual_qty) + flt(args.get("actual_qty", 0))
		self.doc.ordered_qty = flt(self.doc.ordered_qty) + flt(args.get("ordered_qty", 0))
		self.doc.reserved_qty = flt(self.doc.reserved_qty) + flt(args.get("reserved_qty"))
		self.doc.indented_qty = flt(self.doc.indented_qty) + flt(args.get("indented_qty"))
		self.doc.planned_qty = flt(self.doc.planned_qty) + flt(args.get("planned_qty"))
		
		self.doc.projected_qty = flt(self.doc.actual_qty) + flt(self.doc.ordered_qty) + \
		 	flt(self.doc.indented_qty) + flt(self.doc.planned_qty) - flt(self.doc.reserved_qty)
		
		self.doc.save()
	
	def get_first_sle(self):
		sle = sql("""
			select * from `tabStock Ledger Entry`
			where item_code = %s
			and warehouse = %s
			and ifnull(is_cancelled, 'No') = 'No'
			order by timestamp(posting_date, posting_time) asc, name asc
			limit 1
		""", (self.doc.item_code, self.doc.warehouse), as_dict=1)
		return sle and sle[0] or None

	def get_prev_sle(self, posting_date = '1900-01-01', posting_time = '12:00', sle_id = ''):
		"""
			get the last sle on or before the current time-bucket, 
			to get actual qty before transaction, this function
			is called from various transaction like stock entry, reco etc
		"""
		
		sle = sql("""
			select * from `tabStock Ledger Entry`
			where item_code = %s
			and warehouse = %s
			and ifnull(is_cancelled, 'No') = 'No'
			and name != %s
			and timestamp(posting_date, posting_time) <= timestamp(%s, %s)
			order by timestamp(posting_date, posting_time) desc, name desc
			limit 1
		""", (self.doc.item_code, self.doc.warehouse, sle_id, posting_date, posting_time), as_dict=1)

		return sle and sle[0] or {}

	def get_sle_prev_timebucket(self, posting_date = '1900-01-01', posting_time = '12:00'):
		"""get previous stock ledger entry before current time-bucket"""
		# get the last sle before the current time-bucket, so that all values
		# are reposted from the current time-bucket onwards.
		# this is necessary because at the time of cancellation, there may be
		# entries between the cancelled entries in the same time-bucket

		sle = sql("""
			select * from `tabStock Ledger Entry`
			where item_code = %s
			and warehouse = %s
			and ifnull(is_cancelled, 'No') = 'No'
			and timestamp(posting_date, posting_time) < timestamp(%s, %s)
			order by timestamp(posting_date, posting_time) desc, name desc
			limit 1
		""", (self.doc.item_code, self.doc.warehouse, posting_date, posting_time), as_dict=1)

		return sle and sle[0] or {}

	def validate_negative_stock(self, cqty, s):
		"""
			validate negative stock for entries current datetime onwards
			will not consider cancelled entries
		"""
		diff = cqty + s['actual_qty']
		if  diff < 0 and (abs(diff) > 0.0001) and s['is_cancelled'] == 'No':
			self.exc_list.append({
				"diff": diff,
				"posting_date": s["posting_date"],
				"posting_time": s["posting_time"],
				"voucher_type": s["voucher_type"],
				"voucher_no": s["voucher_no"]
			})
			return True
		else:
			return False
			
	def get_serialized_inventory_values(self, val_rate, in_rate, opening_qty, \
			actual_qty, is_cancelled, serial_nos):
		"""
			get serialized inventory values
		"""
		if flt(in_rate) < 0: # wrong incoming rate
			in_rate = val_rate
		elif flt(in_rate) == 0 or flt(actual_qty) < 0: 
			# In case of delivery/stock issue, get average purchase rate
			# of serial nos of current entry
			in_rate = flt(sql("""select ifnull(avg(purchase_rate), 0) 
				from `tabSerial No` where name in (%s)""" % (serial_nos))[0][0])

		if in_rate and val_rate == 0: # First entry
			val_rate = in_rate
		# val_rate is same as previous entry if val_rate is negative
		# Otherwise it will be calculated as per moving average
		elif opening_qty + actual_qty > 0 and ((opening_qty * val_rate) + \
				(actual_qty * in_rate)) > 0:
			val_rate = ((opening_qty *val_rate) + (actual_qty * in_rate)) / \
				(opening_qty + actual_qty)
		return val_rate, in_rate

	def get_moving_average_inventory_values(self, val_rate, in_rate, opening_qty, actual_qty, is_cancelled):
		if flt(in_rate) == 0 or flt(actual_qty) < 0: 
			# In case of delivery/stock issue in_rate = 0 or wrong incoming rate
			in_rate = val_rate

		# val_rate is same as previous entry if :
		# 1. actual qty is negative(delivery note / stock entry)
		# 2. cancelled entry
		# 3. val_rate is negative
		# Otherwise it will be calculated as per moving average
		if actual_qty > 0 and (opening_qty + actual_qty) > 0 and is_cancelled == 'No' \
				and ((opening_qty * val_rate) + (actual_qty * in_rate)) > 0:
			opening_qty = opening_qty > 0 and opening_qty or 0
			val_rate = ((opening_qty *val_rate) + (actual_qty * in_rate)) / \
				(opening_qty + actual_qty)
		elif (opening_qty + actual_qty) <= 0:
			val_rate = 0
		return val_rate, in_rate

	def get_fifo_inventory_values(self, in_rate, actual_qty):
		# add batch to fcfs balance
		if actual_qty > 0:
			self.fcfs_bal.append([flt(actual_qty), flt(in_rate)])

		# remove from fcfs balance
		else:
			incoming_cost = 0
			withdraw = flt(abs(actual_qty))
			while withdraw:
				if not self.fcfs_bal:
					break # nothing in store
				
				batch = self.fcfs_bal[0]
				
				if batch[0] <= withdraw:
					# not enough or exactly same qty in current batch, clear batch
					incoming_cost += flt(batch[1])*flt(batch[0])
					withdraw -= batch[0]
					self.fcfs_bal.pop(0)
					

				else:
					# all from current batch
					incoming_cost += flt(batch[1])*flt(withdraw)
					batch[0] -= withdraw
					withdraw = 0
			
			in_rate = incoming_cost / flt(abs(actual_qty))

		fcfs_val = sum([flt(d[0])*flt(d[1]) for d in self.fcfs_bal])
		fcfs_qty = sum([flt(d[0]) for d in self.fcfs_bal])
		val_rate = fcfs_qty and fcfs_val / fcfs_qty or 0
		
		return val_rate, in_rate

	def get_valuation_rate(self, val_method, serial_nos, val_rate, in_rate, stock_val, cqty, s):
		if serial_nos:
			val_rate, in_rate = self.get_serialized_inventory_values( \
				val_rate, in_rate, opening_qty = cqty, actual_qty = s['actual_qty'], \
				is_cancelled = s['is_cancelled'], serial_nos = serial_nos)
		elif val_method == 'Moving Average':
			val_rate, in_rate = self.get_moving_average_inventory_values( \
				val_rate, in_rate, opening_qty = cqty, actual_qty = s['actual_qty'], \
				is_cancelled = s['is_cancelled'])
		elif val_method == 'FIFO':
			val_rate, in_rate = self.get_fifo_inventory_values(in_rate, \
				actual_qty = s['actual_qty'])
		return val_rate, in_rate

	def get_stock_value(self, val_method, cqty, val_rate, serial_nos):
		if serial_nos:
			stock_val = flt(val_rate) * flt(cqty)
		elif val_method == 'Moving Average':
			stock_val = flt(cqty) > 0 and flt(val_rate) * flt(cqty) or 0
		elif val_method == 'FIFO':
			stock_val = sum([flt(d[0])*flt(d[1]) for d in self.fcfs_bal])
		return stock_val

	def update_entries_after(self, posting_date, posting_time, verbose=1):
		"""
			update valution rate and qty after transaction 
			from the current time-bucket onwards
		"""
		
		# Get prev sle
		prev_sle = self.get_sle_prev_timebucket(posting_date, posting_time)
		
		# if no prev sle, start from the first one (for repost)
		if not prev_sle:
			cqty, cval, val_rate, stock_val, self.fcfs_bal = 0, 0, 0, 0, []
		
		# normal
		else:
			cqty = flt(prev_sle.get('bin_aqat', 0))
			cval =flt(prev_sle.get('stock_value', 0))
			val_rate = flt(prev_sle.get('valuation_rate', 0))
			self.fcfs_bal = eval(prev_sle.get('fcfs_stack', '[]') or '[]')

		# get valuation method
		val_method = get_obj('Valuation Control').get_valuation_method(self.doc.item_code)

		# allow negative stock (only for moving average method)
		from webnotes.utils import get_defaults
		allow_negative_stock = get_defaults().get('allow_negative_stock', 0)


		# recalculate the balances for all stock ledger entries
		# after the prev sle
		sll = sql("""
			select *
			from `tabStock Ledger Entry` 
			where item_code = %s 
			and warehouse = %s 
			and ifnull(is_cancelled, 'No') = 'No'
			and timestamp(posting_date, posting_time) > timestamp(%s, %s)
			order by timestamp(posting_date, posting_time) asc, name asc""", \
				(self.doc.item_code, self.doc.warehouse, \
					prev_sle.get('posting_date','1900-01-01'), \
					prev_sle.get('posting_time', '12:00')), as_dict = 1)
		
		self.exc_list = []
		for sle in sll:
			# block if stock level goes negative on any date
			if (val_method != 'Moving Average') or (cint(allow_negative_stock) == 0):
				if self.validate_negative_stock(cqty, sle):
					cqty += sle['actual_qty']
					continue

			stock_val, in_rate = 0, sle['incoming_rate'] # IN
			serial_nos = sle["serial_no"] and ("'"+"', '".join(cstr(sle["serial_no"]).split('\n')) \
				+ "'") or ''
			# Get valuation rate
			val_rate, in_rate = self.get_valuation_rate(val_method, serial_nos, \
				val_rate, in_rate, stock_val, cqty, sle)		
			# Qty upto the sle
			cqty += sle['actual_qty'] 
			# Stock Value upto the sle
			stock_val = self.get_stock_value(val_method, cqty, val_rate, serial_nos) 
			# update current sle 
			sql("""update `tabStock Ledger Entry` 
				set bin_aqat=%s, valuation_rate=%s, fcfs_stack=%s, stock_value=%s, 
				incoming_rate = %s where name=%s""", \
				(cqty, flt(val_rate), cstr(self.fcfs_bal), stock_val, in_rate, sle['name']))
		
		if self.exc_list:
			deficiency = min(e["diff"] for e in self.exc_list)
			msg = """Negative stock error: 
				Cannot complete this transaction because stock will start
				becoming negative (%s) for Item <b>%s</b> in Warehouse 
				<b>%s</b> on <b>%s %s</b> in Transaction %s %s.
				Total Quantity Deficiency: <b>%s</b>""" % \
				(self.exc_list[0]["diff"], self.doc.item_code, self.doc.warehouse,
				self.exc_list[0]["posting_date"], self.exc_list[0]["posting_time"],
				self.exc_list[0]["voucher_type"], self.exc_list[0]["voucher_no"],
				abs(deficiency))
			if verbose:
				msgprint(msg, raise_exception=1)
			else:
				raise webnotes.ValidationError, msg
		
		# update the bin
		if sll or not prev_sle:
			sql("""update `tabBin` set valuation_rate=%s, actual_qty=%s, stock_value = %s,
				projected_qty = (actual_qty + indented_qty + ordered_qty + planned_qty -
				reserved_qty) where name=%s
			""", (flt(val_rate), cqty, flt(stock_val), self.doc.name))

	def reorder_item(self,doc_type,doc_name):
		""" Reorder item if stock reaches reorder level"""

		if webnotes.conn.get_value('Global Defaults', None, 'auto_indent'):
			#check if re-order is required
			ret = sql("""select re_order_level, item_name, description, brand, item_group,
			 	lead_time_days, min_order_qty, email_notify, re_order_qty 
				from tabItem where name = %s""", (self.doc.item_code), as_dict=1)
			
			current_qty = sql("""
				select sum(t1.actual_qty) + sum(t1.indented_qty) + sum(t1.ordered_qty) -sum(t1.reserved_qty)
				from tabBin t1, tabWarehouse t2
				where t1.item_code = %s 
				and t1.warehouse = t2.name
				and t2.warehouse_type in ('Stores', 'Reserved', 'Default Warehouse Type')
				and t1.docstatus != 2
			""", self.doc.item_code)

			if ret[0]["re_order_level"] and current_qty and \
					(flt(ret[0]['re_order_level']) > flt(current_qty[0][0])):
				self.create_auto_indent(ret[0], doc_type, doc_name, current_qty[0][0])

	def create_auto_indent(self, i , doc_type, doc_name, cur_qty):
		"""	Create indent on reaching reorder level	"""
		indent = Document('Purchase Request')
		indent.transaction_date = nowdate()
		indent.naming_series = 'IDT'
		indent.company = get_defaults()['company']
		indent.fiscal_year = get_defaults()['fiscal_year']
		indent.remark = """This is an auto generated Purchase Request. 
			It was raised because the (actual + ordered + indented - reserved) quantity 
			reaches re-order level when %s %s was created""" % (doc_type,doc_name)
		indent.save(1)
		indent_obj = get_obj('Purchase Request',indent.name,with_children=1)
		indent_details_child = addchild(indent_obj.doc,'indent_details','Purchase Request Item',0)
		indent_details_child.item_code = self.doc.item_code
		indent_details_child.uom = self.doc.stock_uom
		indent_details_child.warehouse = self.doc.warehouse
		indent_details_child.schedule_date= add_days(nowdate(),cint(i['lead_time_days']))
		indent_details_child.item_name = i['item_name']
		indent_details_child.description = i['description']
		indent_details_child.item_group = i['item_group']
		indent_details_child.qty = i['re_order_qty'] or (flt(i['re_order_level']) - flt(cur_qty))
		indent_details_child.brand = i['brand']
		indent_details_child.save()
		indent_obj = get_obj('Purchase Request',indent.name,with_children=1)
		indent_obj.validate()
		webnotes.conn.set(indent_obj.doc,'docstatus',1)
		indent_obj.on_submit()
		msgprint("""Item: %s is to be re-ordered. Purchase Request %s raised. 
			It was generated from %s: %s""" % 
			(self.doc.item_code, indent.name, doc_type, doc_name ))
		if(i['email_notify']):
			self.send_email_notification(doc_type, doc_name)
			
	def send_email_notification(self, doc_type, doc_name):
		""" Notify user about auto creation of indent"""
		
		from webnotes.utils.email_lib import sendmail
		email_list=[d[0] for d in sql("""select distinct r.parent from tabUserRole r, tabProfile p
			where p.name = r.parent and p.enabled = 1 and p.docstatus < 2
			and r.role in ('Purchase Manager','Material Manager') 
			and p.name not in ('Administrator', 'All', 'Guest')""")]
		msg="""A Purchase Request has been raised 
			for item %s: %s on %s """ % (doc_type, doc_name, nowdate())
		sendmail(email_list, subject='Auto Purchase Request Generation Notification', msg = msg)	

	def validate(self):
		self.validate_mandatory()

	def validate_mandatory(self):
		qf = ['actual_qty', 'reserved_qty', 'ordered_qty', 'indented_qty']
		for f in qf:
			if (not self.doc.fields.has_key(f)) or (not self.doc.fields[f]): 
				self.doc.fields[f] = 0.0
