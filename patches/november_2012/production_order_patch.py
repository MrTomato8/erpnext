def execute():
	import webnotes
	
	webnotes.reload_doc("manufacturing", "doctype", "production_order")
	webnotes.reload_doc("stock", "doctype", "stock_entry")